import type { DisplayEdge, DisplayNode } from './projection.js'

const ORIGIN_X = 80
const ORIGIN_Y = 80
const HOST_W = 280
const HOST_H = 156
const HELPER_W = 200
const HELPER_H = 80
const JSON_HELPER_W = 200
const JSON_HELPER_H = 168
const COL_GAP = 56
const ROW_GAP = 28
const MODULE_GAP = 72

const HELPER_OP_IDS = new Set(['number_const', 'text_panel', 'toggle', 'json_panel'])

export function isHelperOp(opId: string): boolean {
  return HELPER_OP_IDS.has(opId)
}

function familyOrder(functionName: string): number {
  if (functionName === 'point2d') return 0
  if (functionName === 'basePlane') return 1
  if (
    functionName === 'polyline2d'
    || functionName === 'spline2d'
    || functionName === 'polygon2d'
    || functionName === 'network2d'
    || functionName === 'geometryMask'
  ) return 2
  if (
    functionName === 'heightfield'
    || functionName === 'heightfieldExplode'
    || functionName === 'heightfieldSetMask'
    || functionName === 'heightfieldMesh'
  ) return 4
  if (
    functionName === 'emptyScene'
    || functionName === 'sceneNode'
    || functionName === 'addChild'
    || functionName === 'sceneOutput'
  ) return 5
  return 3
}

function incomingHostIds(
  nodeId: string,
  nodes: Record<string, DisplayNode>,
  incoming: Map<string, string[]>,
): string[] {
  return (incoming.get(nodeId) ?? []).filter((id) => {
    const node = nodes[id]
    return node && !isHelperOp(node.opId)
  })
}

function hostRank(
  nodeId: string,
  nodes: Record<string, DisplayNode>,
  incoming: Map<string, string[]>,
  memo: Map<string, number>,
  walking: Set<string>,
): number {
  const hit = memo.get(nodeId)
  if (hit !== undefined) return hit
  if (walking.has(nodeId)) return familyOrder(nodes[nodeId]?.functionName ?? '')
  walking.add(nodeId)
  const preds = incomingHostIds(nodeId, nodes, incoming)
  const rank = preds.length === 0
    ? familyOrder(nodes[nodeId]?.functionName ?? '')
    : 1 + Math.max(...preds.map((id) => hostRank(id, nodes, incoming, memo, walking)))
  walking.delete(nodeId)
  memo.set(nodeId, rank)
  return rank
}

function indexIncoming(edges: Record<string, DisplayEdge>): Map<string, string[]> {
  const incoming = new Map<string, string[]>()
  for (const edge of Object.values(edges)) {
    const list = incoming.get(edge.target.nodeId) ?? []
    if (!list.includes(edge.source.nodeId)) list.push(edge.source.nodeId)
    incoming.set(edge.target.nodeId, list)
  }
  return incoming
}

function indexOutgoing(edges: Record<string, DisplayEdge>): Map<string, string[]> {
  const outgoing = new Map<string, string[]>()
  for (const edge of Object.values(edges)) {
    const list = outgoing.get(edge.source.nodeId) ?? []
    if (!list.includes(edge.target.nodeId)) list.push(edge.target.nodeId)
    outgoing.set(edge.source.nodeId, list)
  }
  return outgoing
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function helperStackHeight(
  hostId: string,
  nodes: Record<string, DisplayNode>,
  outgoing: Map<string, string[]>,
  layout?: Record<string, { x: number; y: number }>,
): number {
  return Object.values(nodes)
    .filter((node) =>
      isHelperOp(node.opId)
      && !layout?.[node.id]
      && (outgoing.get(node.id) ?? []).includes(hostId),
    )
    .reduce((sum, node) => sum + helperSize(node.opId).h, 0)
}

function hostHeight(stack: number): number {
  return Math.max(HOST_H, stack)
}

function helperSize(opId: string): { w: number; h: number } {
  return opId === 'json_panel' ? { w: JSON_HELPER_W, h: JSON_HELPER_H } : { w: HELPER_W, h: HELPER_H }
}

function boxesOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function resolveOverlaps(
  nodes: Record<string, DisplayNode>,
  sizeOf: (node: DisplayNode) => { w: number; h: number },
  layout?: Record<string, { x: number; y: number }>,
): void {
  const movable = Object.values(nodes).filter((node) => !layout?.[node.id])
  for (let pass = 0; pass < 12; pass += 1) {
    let moved = false
    movable.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
    for (let i = 0; i < movable.length; i += 1) {
      const a = movable[i]!
      const as = sizeOf(a)
      for (let j = i + 1; j < movable.length; j += 1) {
        const b = movable[j]!
        const bs = sizeOf(b)
        if (!boxesOverlap(
          { x: a.position.x, y: a.position.y, ...as },
          { x: b.position.x, y: b.position.y, ...bs },
        )) continue
        b.position = { x: b.position.x, y: a.position.y + as.h + ROW_GAP }
        moved = true
      }
    }
    if (!moved) break
  }
}

/**
 * Layer host batteries left-to-right by data-flow. Sit Basic/input helpers
 * beside their consumer. Pack columns so connected nodes stay close, and
 * push overlapping boxes apart. Stored `layout` positions stay put.
 */
export function applyAutomaticDisplayLayout(
  nodes: Record<string, DisplayNode>,
  edges: Record<string, DisplayEdge>,
  layout?: Record<string, { x: number; y: number }>,
): void {
  const incoming = indexIncoming(edges)
  const outgoing = indexOutgoing(edges)
  // Topology and pinned helpers stay fixed while only positions change.
  const stackHeights = new Map<string, number>()
  const stackHeight = (id: string): number => {
    if (!stackHeights.has(id)) stackHeights.set(id, helperStackHeight(id, nodes, outgoing, layout))
    return stackHeights.get(id)!
  }
  const ranks = new Map<string, number>()
  const walking = new Set<string>()
  const appear = new Map(Object.keys(nodes).map((id, index) => [id, index]))
  const moduleFiles: string[] = []
  for (const node of Object.values(nodes)) {
    const file = node.moduleFile ?? 'main.scene.ts'
    if (!moduleFiles.includes(file)) moduleFiles.push(file)
    if (!isHelperOp(node.opId)) hostRank(node.id, nodes, incoming, ranks, walking)
  }

  const colWidth = HELPER_W + 24 + HOST_W + COL_GAP
  let bandY = ORIGIN_Y
  for (const file of moduleFiles) {
    const hosts = Object.values(nodes).filter((node) =>
      (node.moduleFile ?? 'main.scene.ts') === file && !isHelperOp(node.opId) && !layout?.[node.id],
    )
    const occupied = [...new Set(hosts.map((node) => ranks.get(node.id) ?? 0))].sort((a, b) => a - b)
    const colOf = new Map(occupied.map((rank, index) => [rank, index]))
    const byCol = new Map<number, DisplayNode[]>()
    for (const node of hosts) {
      const col = colOf.get(ranks.get(node.id) ?? 0) ?? 0
      const list = byCol.get(col) ?? []
      list.push(node)
      byCol.set(col, list)
    }

    let tallest = 0
    for (const [col, list] of [...byCol.entries()].sort((a, b) => a[0] - b[0])) {
      list.sort((a, b) => {
        const ay = median(incomingHostIds(a.id, nodes, incoming).map((id) => nodes[id]?.position.y ?? 0))
        const by = median(incomingHostIds(b.id, nodes, incoming).map((id) => nodes[id]?.position.y ?? 0))
        if (ay !== by) return ay - by
        const family = familyOrder(a.functionName) - familyOrder(b.functionName)
        if (family !== 0) return family
        return (appear.get(a.id) ?? 0) - (appear.get(b.id) ?? 0)
      })
      let y = bandY
      list.forEach((node) => {
        const height = hostHeight(stackHeight(node.id))
        const preds = incomingHostIds(node.id, nodes, incoming)
        const targetY = preds.length > 0
          ? median(preds.map((id) => nodes[id]?.position.y ?? y))
          : y
        node.position = {
          x: ORIGIN_X + HELPER_W + 24 + col * colWidth,
          y: Math.max(y, targetY),
        }
        y = node.position.y + height + ROW_GAP
      })
      tallest = Math.max(tallest, y - bandY)
    }

    const helpers = Object.values(nodes).filter((node) =>
      (node.moduleFile ?? 'main.scene.ts') === file && isHelperOp(node.opId) && !layout?.[node.id],
    )
    const slots = new Map<string, number>()
    helpers.sort((a, b) => (appear.get(a.id) ?? 0) - (appear.get(b.id) ?? 0))
    for (const helper of helpers) {
      const consumers = (outgoing.get(helper.id) ?? [])
        .map((id) => nodes[id])
        .filter((node): node is DisplayNode => Boolean(node) && !isHelperOp(node.opId))
        .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
      const parent = consumers[0]
      const size = helperSize(helper.opId)
      if (!parent) {
        const orphan = slots.get(`${file}::orphan`) ?? 0
        slots.set(`${file}::orphan`, orphan + size.h)
        helper.position = { x: ORIGIN_X, y: bandY + orphan }
        continue
      }
      const key = parent.id
      const slot = slots.get(key) ?? 0
      slots.set(key, slot + size.h)
      helper.position = {
        x: parent.position.x - size.w - 24,
        y: parent.position.y + slot,
      }
    }

    const sizeOf = (node: DisplayNode) => (
      isHelperOp(node.opId)
        ? helperSize(node.opId)
        : { w: HOST_W, h: hostHeight(stackHeight(node.id)) }
    )
    resolveOverlaps(nodes, sizeOf, layout)

    const used = Math.max(
      tallest,
      ...Object.values(nodes)
        .filter((node) => (node.moduleFile ?? 'main.scene.ts') === file && !layout?.[node.id])
        .map((node) => node.position.y - bandY + sizeOf(node).h),
      HOST_H,
    )
    bandY += used + MODULE_GAP
  }
}
