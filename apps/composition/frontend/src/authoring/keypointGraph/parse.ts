// Pure parser: a raw keypoint value ({ hierarchy, relations }) → a flat, validated
// graph model the canvas + list render from. Never throws; every problem is
// collected into `warnings` so the panel degrades gracefully.

export type RelationKind = 'clearance' | 'orientation'

export interface KNode {
  id: string
  name: string
  area: number
  depth: number
  parentId: string | null
  /** optional solved position (meters), x=east, y=north — set by keypoint_layout */
  position?: { x: number; y: number }
}

/** Implicit parent → child edge derived from the hierarchy. */
export interface KParentEdge {
  from: string
  to: string
}

/** Explicit relation edge from `relations[]`. */
export interface KRelationEdge {
  id: string
  from: string
  to: string
  kind: RelationKind
  /** meters, for kind === 'clearance' */
  distance?: number
  /** e.g. N/E/S/W, for kind === 'orientation' */
  direction?: string
}

export interface KeypointModel {
  nodes: KNode[]
  parentEdges: KParentEdge[]
  relationEdges: KRelationEdge[]
  rootId: string | null
  warnings: string[]
}

function emptyModel(warnings: string[]): KeypointModel {
  return { nodes: [], parentEdges: [], relationEdges: [], rootId: null, warnings }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Parse an optional node position: accepts { x, y } or [x, y] with finite numbers. */
function parsePosition(raw: unknown): { x: number; y: number } | undefined {
  if (Array.isArray(raw) && raw.length >= 2) {
    const x = Number(raw[0])
    const y = Number(raw[1])
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y }
    return undefined
  }
  if (isObject(raw)) {
    const x = Number((raw as Record<string, unknown>).x)
    const y = Number((raw as Record<string, unknown>).y)
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y }
  }
  return undefined
}

function coerceArea(raw: unknown, id: string, warnings: string[]): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (raw === undefined || raw === null) {
    warnings.push(`节点 "${id}" 缺少 area，按 0 处理`)
    return 0
  }
  const n = Number(raw)
  if (Number.isFinite(n)) return n
  warnings.push(`节点 "${id}" 的 area 不是有效数值，按 0 处理`)
  return 0
}

/**
 * Parse a raw keypoint value into the render model. Accepts an object or a JSON
 * string. Tolerant of missing/invalid fields, duplicate ids and cyclic children.
 */
export function parseKeypoint(raw: unknown): KeypointModel {
  const warnings: string[] = []

  let value: unknown = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return emptyModel(['keypoint 不是有效的 JSON 字符串'])
    }
  }

  if (!isObject(value)) return emptyModel(['keypoint 不是对象'])

  const hierarchy = value.hierarchy
  const relations = value.relations

  const nodes: KNode[] = []
  const parentEdges: KParentEdge[] = []
  const seen = new Set<string>()
  let rootId: string | null = null
  let autoId = 0

  if (!isObject(hierarchy)) {
    warnings.push('缺少 hierarchy 树（或不是对象）')
  } else {
    const stack: Array<{ node: Record<string, unknown>; parentId: string | null; depth: number }> = [
      { node: hierarchy, parentId: null, depth: 0 },
    ]
    while (stack.length > 0) {
      const { node, parentId, depth } = stack.shift() as (typeof stack)[number]

      let id = typeof node.id === 'string' && node.id.trim() ? node.id.trim() : ''
      if (!id) {
        id = `node_${autoId++}`
        warnings.push(`存在缺少 id 的节点，已分配临时 id "${id}"`)
      }
      if (seen.has(id)) {
        warnings.push(`重复的节点 id "${id}"，已忽略后一个（含其子树）`)
        continue
      }
      seen.add(id)

      const name = typeof node.name === 'string' && node.name.trim() ? node.name : id
      const area = coerceArea(node.area, id, warnings)
      const position = parsePosition(node.position)

      nodes.push({ id, name, area, depth, parentId, position })
      if (parentId === null) rootId = id
      else parentEdges.push({ from: parentId, to: id })

      const children = node.children
      if (Array.isArray(children)) {
        for (const child of children) {
          if (isObject(child)) {
            stack.push({ node: child, parentId: id, depth: depth + 1 })
          } else {
            warnings.push(`节点 "${id}" 的某个 child 不是对象，已忽略`)
          }
        }
      }
    }
  }

  const relationEdges: KRelationEdge[] = []
  if (relations !== undefined) {
    if (!Array.isArray(relations)) {
      warnings.push('relations 不是数组，已忽略')
    } else {
      relations.forEach((entry, i) => {
        if (!isObject(entry)) {
          warnings.push(`relations[${i}] 不是对象，已忽略`)
          return
        }
        const from = typeof entry.from === 'string' ? entry.from : ''
        const to = typeof entry.to === 'string' ? entry.to : ''
        const kind = entry.kind
        if (!seen.has(from) || !seen.has(to)) {
          warnings.push(`relations[${i}] 引用了不存在的节点（from="${from}", to="${to}"），已忽略`)
          return
        }
        if (kind === 'clearance') {
          const distance =
            typeof entry.distance === 'number' && Number.isFinite(entry.distance) ? entry.distance : undefined
          if (distance === undefined) {
            warnings.push(`relations[${i}] (clearance) 缺少有效 distance，已忽略`)
            return
          }
          relationEdges.push({ id: `rel_${i}`, from, to, kind: 'clearance', distance })
        } else if (kind === 'orientation') {
          const direction = typeof entry.direction === 'string' && entry.direction.trim() ? entry.direction.trim() : undefined
          if (direction === undefined) {
            warnings.push(`relations[${i}] (orientation) 缺少 direction，已忽略`)
            return
          }
          relationEdges.push({ id: `rel_${i}`, from, to, kind: 'orientation', direction })
        } else {
          warnings.push(`relations[${i}] 的 kind="${String(kind)}" 不支持，已忽略`)
        }
      })
    }
  }

  return { nodes, parentEdges, relationEdges, rootId, warnings }
}
