// Build a ProblemModel from a raw keypoint value ({ hierarchy, relations }).
// Tolerant: never throws; problems are collected into `warnings`. This is the
// backend counterpart of the frontend keypointGraph/parse.ts (different package,
// so intentionally not shared).

import type { ProblemModel, SolverNode, SolverRelation } from './types.ts'
import { directionToAngle } from './directions.ts'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Accept an object or a JSON string; return the parsed object or null. */
export function coerceKeypointObject(raw: unknown): Record<string, unknown> | null {
  let value: unknown = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  return isObject(value) ? value : null
}

/** Circle radius from area (area = π r²). */
export function radiusFromArea(area: number): number {
  return Math.sqrt(Math.max(0, area) / Math.PI)
}

function coerceArea(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

export function buildModel(raw: unknown): ProblemModel {
  const warnings: string[] = []
  const nodes: SolverNode[] = []
  const index = new Map<string, number>()
  const relations: SolverRelation[] = []

  const root = coerceKeypointObject(raw)
  if (!root) {
    warnings.push('keypoint 不是对象或有效 JSON 字符串')
    return { nodes, index, relations, warnings }
  }

  const hierarchy = root.hierarchy
  const childLists = new Map<string, string[]>() // parentId → childIds (filled during walk)
  let autoId = 0

  if (!isObject(hierarchy)) {
    warnings.push('缺少 hierarchy 树（或不是对象）')
  } else {
    const stack: Array<{ node: Record<string, unknown>; parentId: string | null }> = [
      { node: hierarchy, parentId: null },
    ]
    while (stack.length > 0) {
      const { node, parentId } = stack.shift() as { node: Record<string, unknown>; parentId: string | null }

      let id = typeof node.id === 'string' && node.id.trim() ? node.id.trim() : ''
      if (!id) {
        id = `node_${autoId++}`
        warnings.push(`存在缺少 id 的节点，已分配临时 id "${id}"`)
      }
      if (index.has(id)) {
        warnings.push(`重复的节点 id "${id}"，已忽略后一个（含其子树）`)
        continue
      }

      const name = typeof node.name === 'string' && node.name.trim() ? node.name : id
      const area = coerceArea(node.area)
      index.set(id, nodes.length)
      const children = node.children
      nodes.push({
        id,
        name,
        area,
        radius: radiusFromArea(area),
        isContainer: Array.isArray(children) && children.some(isObject),
        parentId,
        childIds: [],
      })
      childLists.set(id, [])
      if (parentId !== null) childLists.get(parentId)?.push(id)

      if (Array.isArray(children)) {
        for (const child of children) {
          if (isObject(child)) stack.push({ node: child, parentId: id })
          else warnings.push(`节点 "${id}" 的某个 child 不是对象，已忽略`)
        }
      }
    }
  }

  // Attach resolved child id lists.
  for (const node of nodes) node.childIds = childLists.get(node.id) ?? []

  const relRaw = root.relations
  if (relRaw !== undefined) {
    if (!Array.isArray(relRaw)) {
      warnings.push('relations 不是数组，已忽略')
    } else {
      relRaw.forEach((entry, i) => {
        if (!isObject(entry)) {
          warnings.push(`relations[${i}] 不是对象，已忽略`)
          return
        }
        const from = typeof entry.from === 'string' ? entry.from : ''
        const to = typeof entry.to === 'string' ? entry.to : ''
        if (!index.has(from) || !index.has(to)) {
          warnings.push(`relations[${i}] 引用了不存在的节点（from="${from}", to="${to}"），已忽略`)
          return
        }
        if (from === to) {
          warnings.push(`relations[${i}] 的 from/to 相同 ("${from}")，已忽略`)
          return
        }
        if (entry.kind === 'clearance') {
          const distance =
            typeof entry.distance === 'number' && Number.isFinite(entry.distance) ? entry.distance : undefined
          if (distance === undefined) {
            warnings.push(`relations[${i}] (clearance) 缺少有效 distance，已忽略`)
            return
          }
          relations.push({ from, to, kind: 'clearance', distance })
        } else if (entry.kind === 'orientation') {
          const token = typeof entry.direction === 'string' ? entry.direction : ''
          const angle = token ? directionToAngle(token) : null
          if (angle === null) {
            warnings.push(`relations[${i}] (orientation) 的 direction="${token}" 无法识别，已忽略`)
            return
          }
          relations.push({ from, to, kind: 'orientation', angle })
        } else if (entry.kind === 'peripheral') {
          relations.push({ from, to, kind: 'peripheral' })
        } else {
          warnings.push(`relations[${i}] 的 kind="${String(entry.kind)}" 不支持，已忽略`)
        }
      })
    }
  }

  return { nodes, index, relations, warnings }
}

// For each node index, the set of its ancestor indices (parent, grandparent, …).
// Memoized per model object: optimize() calls terms many times with the same model.
const ancestorCache = new WeakMap<ProblemModel, Array<Set<number>>>()

export function ancestorSets(model: ProblemModel): Array<Set<number>> {
  const cached = ancestorCache.get(model)
  if (cached) return cached
  const anc = model.nodes.map(() => new Set<number>())
  model.nodes.forEach((node, i) => {
    let pid = node.parentId
    let guard = 0
    while (pid !== null && guard < model.nodes.length) {
      const pi = model.index.get(pid)
      if (pi === undefined) break
      anc[i].add(pi)
      pid = model.nodes[pi].parentId
      guard += 1
    }
  })
  ancestorCache.set(model, anc)
  return anc
}

/** True when a and b are in an ancestor–descendant relationship (either direction). */
export function isNested(anc: Array<Set<number>>, a: number, b: number): boolean {
  return anc[a].has(b) || anc[b].has(a)
}
