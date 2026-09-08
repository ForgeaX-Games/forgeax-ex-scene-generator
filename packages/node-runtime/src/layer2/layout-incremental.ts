// Incremental edge-aware layout for nodes added in a single applyBatch.
//
// Only nodes created without an explicit `position` in this batch are
// repositioned. Existing graph nodes and nodes with caller-supplied
// coordinates are never moved — they act as fixed anchors and obstacles.
//
// Layout rules (visual data-flow first):
//   - Main chain: always extend RIGHT at a stable flow Y (execution order).
//   - Parallel branches from one parent: stack vertically BELOW the chain row,
//     same first column — never pull the chain child into the branch stack.
//   - Feeders to an existing target: one column LEFT of the target.
//   - Disconnected nodes: fixed column to the RIGHT of the graph, stacked
//     vertically (no diagonal staircase, no wrapping to a new row below).

import type { GraphFileV1 } from '../layer1/storage/types.js'
import type { GraphNode, Position } from '../layer1/types/graph.js'
import type { OpRegistry } from '../layer1/op-registry.js'
import { GROUP_OP_ID } from './group-constants.js'

/** Minimal op shape used to detect auto-layout candidates (avoids circular import). */
interface LayoutTrackableOp {
  type: string
  nodeId?: string
  groupId?: string
  position?: Position
}

const COL_GAP = 80
const ROW_GAP = 40
const OVERLAP_MARGIN = 12
const DEFAULT_BATTERY_W = 180
const DEFAULT_BATTERY_H = 120
const DEFAULT_GROUP_W = 200
const PORT_ROW_H = 28
const HEADER_H = 80

interface Size {
  w: number
  h: number
}

interface Rect extends Size {
  x: number
  y: number
}

function rectRight(r: Rect): number {
  return r.x + r.w
}

function centerY(r: Rect): number {
  return r.y + r.h / 2
}

function rectsOverlap(a: Rect, b: Rect, margin = OVERLAP_MARGIN): boolean {
  return (
    a.x < b.x + b.w + margin &&
    a.x + a.w + margin > b.x &&
    a.y < b.y + b.h + margin &&
    a.y + a.h + margin > b.y
  )
}

function estimateNodeSize(node: GraphNode, graph: GraphFileV1, registry?: OpRegistry): Size {
  const savedW = node.params._nodeWidth
  const savedH = node.params._nodeHeight
  if (typeof savedW === 'number' && typeof savedH === 'number') {
    return { w: savedW, h: savedH }
  }

  if (node.opId === GROUP_OP_ID) {
    const groupId = typeof node.params.groupId === 'string' ? node.params.groupId : node.id
    const grp = graph.groups?.[groupId]
    if (grp) {
      const inCount = (grp.exposedInputs ?? []).filter((p) => !p.hidden).length
      const outCount = (grp.exposedOutputs ?? []).filter((p) => !p.hidden).length
      const portRows = Math.max(inCount, outCount, 1)
      const nameLen = Math.max(grp.name?.length ?? 0, grp.nameEn?.length ?? 0)
      return {
        w: Math.max(DEFAULT_GROUP_W, Math.ceil(nameLen * 8 + 120)),
        h: Math.max(DEFAULT_BATTERY_H, portRows * PORT_ROW_H + HEADER_H),
      }
    }
    return { w: DEFAULT_GROUP_W, h: DEFAULT_BATTERY_H }
  }

  const spec = registry?.get(node.opId)
  if (spec) {
    let inCount = spec.inputs.length
    let outCount = spec.outputs.length
    if (spec.dynamicInputs && typeof node.params.portCount === 'number') {
      inCount = Math.max(inCount, node.params.portCount)
    }
    const portRows = Math.max(inCount, outCount, 1)
    const titleLen = Math.max(node.name?.length ?? 0, spec.id.length)
    return {
      w: Math.max(DEFAULT_BATTERY_W, Math.ceil(titleLen * 8 + 88)),
      h: Math.max(DEFAULT_BATTERY_H, portRows * PORT_ROW_H + HEADER_H),
    }
  }

  return { w: DEFAULT_BATTERY_W, h: DEFAULT_BATTERY_H }
}

function nodeRect(node: GraphNode, graph: GraphFileV1, registry?: OpRegistry): Rect {
  const size = estimateNodeSize(node, graph, registry)
  return { x: node.position.x, y: node.position.y, ...size }
}

/** Collect top-level node ids that should receive auto layout in this batch. */
export function collectAutoLayoutNodeIds(ops: readonly LayoutTrackableOp[]): Set<string> {
  const ids = new Set<string>()
  for (const op of ops) {
    if (op.type === 'createNode' && op.position === undefined && op.nodeId !== undefined) {
      ids.add(op.nodeId)
    }
    if (op.type === 'createGroup' && op.position === undefined && op.groupId !== undefined) {
      ids.add(op.groupId)
    }
  }
  return ids
}

function opCreationIndex(ops: readonly LayoutTrackableOp[]): Map<string, number> {
  const index = new Map<string, number>()
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    if (op.type === 'createNode' && op.nodeId !== undefined) index.set(op.nodeId, i)
    if (op.type === 'createGroup' && op.groupId !== undefined) index.set(op.groupId, i)
  }
  return index
}

function sortForPlacement(
  ids: readonly string[],
  after: GraphFileV1,
  autoIds: Set<string>,
  opIndex: Map<string, number>,
): string[] {
  const idSet = new Set(ids)
  const inDegree = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const id of ids) {
    inDegree.set(id, 0)
    adj.set(id, [])
  }

  for (const edge of Object.values(after.edges)) {
    const src = edge.source.nodeId
    const tgt = edge.target.nodeId
    if (!idSet.has(src) || !idSet.has(tgt) || !autoIds.has(src) || !autoIds.has(tgt)) continue
    adj.get(src)!.push(tgt)
    inDegree.set(tgt, (inDegree.get(tgt) ?? 0) + 1)
  }

  const ready = ids
    .filter((id) => (inDegree.get(id) ?? 0) === 0)
    .sort((a, b) => (opIndex.get(a) ?? 0) - (opIndex.get(b) ?? 0))
  const out: string[] = []
  const queue = [...ready]

  while (queue.length > 0) {
    queue.sort((a, b) => (opIndex.get(a) ?? 0) - (opIndex.get(b) ?? 0))
    const id = queue.shift()!
    out.push(id)
    for (const next of adj.get(id) ?? []) {
      const deg = (inDegree.get(next) ?? 1) - 1
      inDegree.set(next, deg)
      if (deg === 0) queue.push(next)
    }
  }

  if (out.length < ids.length) {
    const missing = ids.filter((id) => !out.includes(id))
    missing.sort((a, b) => (opIndex.get(a) ?? 0) - (opIndex.get(b) ?? 0))
    out.push(...missing)
  }
  return out
}

/** Bounds of nodes that are NOT receiving auto-layout in this batch. */
function fixedNodeBounds(
  after: GraphFileV1,
  autoIds: Set<string>,
  placedRects: ReadonlyMap<string, Rect>,
  registry?: OpRegistry,
): { maxRight: number; minY: number; any: boolean } {
  let maxRight = -COL_GAP
  let minY = 0
  let any = false
  for (const [id, node] of Object.entries(after.nodes)) {
    if (autoIds.has(id) && !placedRects.has(id)) continue
    any = true
    const r = placedRects.get(id) ?? nodeRect(node, after, registry)
    maxRight = Math.max(maxRight, rectRight(r))
    minY = Math.min(minY, r.y)
  }
  return { maxRight, minY, any }
}

function resolveVerticalCollision(x: number, y: number, size: Size, obstacles: readonly Rect[]): number {
  let cy = y
  for (let attempt = 0; attempt < 200; attempt++) {
    const candidate: Rect = { x, y: cy, ...size }
    if (!obstacles.some((o) => rectsOverlap(candidate, o))) return cy
    cy += ROW_GAP
  }
  return cy
}

function stackSlotY(
  slot: number,
  _count: number,
  slotHeights: readonly number[],
  anchorCenterY: number,
): number {
  const totalH = slotHeights.reduce((sum, h, i) => sum + h + (i > 0 ? ROW_GAP : 0), 0)
  let y = anchorCenterY - totalH / 2
  for (let i = 0; i < slot; i++) y += slotHeights[i]! + ROW_GAP
  return y
}

function newChildrenOf(
  parentId: string,
  after: GraphFileV1,
  autoIds: Set<string>,
  opIndex: Map<string, number>,
): string[] {
  const children: string[] = []
  for (const edge of Object.values(after.edges)) {
    if (edge.source.nodeId === parentId && autoIds.has(edge.target.nodeId)) {
      children.push(edge.target.nodeId)
    }
  }
  children.sort((a, b) => (opIndex.get(a) ?? 0) - (opIndex.get(b) ?? 0))
  return children
}

function newOutTargets(id: string, after: GraphFileV1, autoIds: Set<string>): string[] {
  const out: string[] = []
  for (const edge of Object.values(after.edges)) {
    if (edge.source.nodeId === id && autoIds.has(edge.target.nodeId)) out.push(edge.target.nodeId)
  }
  return out
}

function downstreamDepth(
  id: string,
  after: GraphFileV1,
  autoIds: Set<string>,
  memo: Map<string, number>,
): number {
  const cached = memo.get(id)
  if (cached !== undefined) return cached
  const outs = newOutTargets(id, after, autoIds)
  if (outs.length === 0) {
    memo.set(id, 0)
    return 0
  }
  const depth = 1 + Math.max(...outs.map((o) => downstreamDepth(o, after, autoIds, memo)))
  memo.set(id, depth)
  return depth
}

/** The child that continues the main left-to-right execution chain. */
function pickPrimaryChild(
  siblings: readonly string[],
  after: GraphFileV1,
  autoIds: Set<string>,
  opIndex: Map<string, number>,
): string {
  if (siblings.length === 1) return siblings[0]!
  const memo = new Map<string, number>()
  let best = siblings[0]!
  let bestDepth = -1
  for (const s of siblings) {
    const d = downstreamDepth(s, after, autoIds, memo)
    const idx = opIndex.get(s) ?? 0
    if (d > bestDepth || (d === bestDepth && idx < (opIndex.get(best) ?? 0))) {
      bestDepth = d
      best = s
    }
  }
  return best
}

function placeFromParent(
  id: string,
  parentRect: Rect,
  parentId: string,
  after: GraphFileV1,
  autoIds: Set<string>,
  opIndex: Map<string, number>,
  registry: OpRegistry | undefined,
): Position {
  const node = after.nodes[id]!
  const size = estimateNodeSize(node, after, registry)
  const siblings = newChildrenOf(parentId, after, autoIds, opIndex)
  const columnX = rectRight(parentRect) + COL_GAP

  if (siblings.length <= 1) {
    return { x: columnX, y: centerY(parentRect) - size.h / 2 }
  }

  const primary = pickPrimaryChild(siblings, after, autoIds, opIndex)
  if (id === primary) {
    return { x: columnX, y: centerY(parentRect) - size.h / 2 }
  }

  const branches = siblings.filter((s) => s !== primary)
  const primaryH = estimateNodeSize(after.nodes[primary]!, after, registry).h
  const branchHeights = branches.map((s) => estimateNodeSize(after.nodes[s]!, after, registry).h)
  const slot = branches.indexOf(id)
  const branchAnchorY = centerY(parentRect) + primaryH / 2 + ROW_GAP + branchHeights[0]! / 2
  return {
    x: columnX,
    y: stackSlotY(slot, branches.length, branchHeights, branchAnchorY),
  }
}

function feedersToTarget(
  targetId: string,
  after: GraphFileV1,
  autoIds: Set<string>,
  opIndex: Map<string, number>,
): string[] {
  const feeders: string[] = []
  for (const edge of Object.values(after.edges)) {
    if (edge.target.nodeId === targetId && autoIds.has(edge.source.nodeId)) {
      feeders.push(edge.source.nodeId)
    }
  }
  feeders.sort((a, b) => (opIndex.get(a) ?? 0) - (opIndex.get(b) ?? 0))
  return feeders
}

function touchesExisting(id: string, after: GraphFileV1, existingIds: Set<string>): boolean {
  for (const edge of Object.values(after.edges)) {
    if (edge.source.nodeId === id && existingIds.has(edge.target.nodeId)) return true
    if (edge.target.nodeId === id && existingIds.has(edge.source.nodeId)) return true
  }
  return false
}

function newOnlyComponents(
  ids: readonly string[],
  after: GraphFileV1,
  existingIds: Set<string>,
): string[][] {
  const newOnly = ids.filter((id) => !touchesExisting(id, after, existingIds))
  const idSet = new Set(newOnly)
  const adj = new Map<string, Set<string>>()
  for (const id of newOnly) adj.set(id, new Set())
  for (const edge of Object.values(after.edges)) {
    const a = edge.source.nodeId
    const b = edge.target.nodeId
    if (idSet.has(a) && idSet.has(b)) {
      adj.get(a)!.add(b)
      adj.get(b)!.add(a)
    }
  }

  const visited = new Set<string>()
  const components: string[][] = []
  for (const start of newOnly) {
    if (visited.has(start)) continue
    const comp: string[] = []
    const queue = [start]
    visited.add(start)
    while (queue.length > 0) {
      const cur = queue.shift()!
      comp.push(cur)
      for (const next of adj.get(cur) ?? []) {
        if (visited.has(next)) continue
        visited.add(next)
        queue.push(next)
      }
    }
    components.push(comp)
  }
  return components
}

function isLinearChainComponent(
  compIds: readonly string[],
  after: GraphFileV1,
): boolean {
  if (compIds.length <= 1) return true
  const set = new Set(compIds)
  for (const id of compIds) {
    let inC = 0
    let outC = 0
    for (const edge of Object.values(after.edges)) {
      if (edge.target.nodeId === id && set.has(edge.source.nodeId)) inC++
      if (edge.source.nodeId === id && set.has(edge.target.nodeId)) outC++
    }
    if (inC > 1 || outC > 1) return false
  }
  return true
}

function layoutLinearChainAtY(
  compIds: readonly string[],
  after: GraphFileV1,
  autoIds: Set<string>,
  opIndex: Map<string, number>,
  registry: OpRegistry | undefined,
  startX: number,
  flowY: number,
): { positions: Map<string, Position>; endX: number } {
  const positions = new Map<string, Position>()
  const order = sortForPlacement(compIds, after, autoIds, opIndex)
  let x = startX

  for (const id of order) {
    const node = after.nodes[id]!
    const size = estimateNodeSize(node, after, registry)
    const inInternal = Object.values(after.edges).some(
      (e) => e.target.nodeId === id && positions.has(e.source.nodeId),
    )
    if (inInternal) {
      const parentId = Object.values(after.edges).find(
        (e) => e.target.nodeId === id && positions.has(e.source.nodeId),
      )!.source.nodeId
      const parentPos = positions.get(parentId)!
      const parentSize = estimateNodeSize(after.nodes[parentId]!, after, registry)
      x = parentPos.x + parentSize.w + COL_GAP
    }
    positions.set(id, { x, y: flowY - size.h / 2 })
  }

  let endX = startX
  for (const id of compIds) {
    const pos = positions.get(id)!
    const size = estimateNodeSize(after.nodes[id]!, after, registry)
    endX = Math.max(endX, pos.x + size.w)
  }
  return { positions, endX }
}

function applyPosition(
  after: GraphFileV1,
  id: string,
  pos: Position,
  placedRects: Map<string, Rect>,
  registry?: OpRegistry,
): void {
  const node = after.nodes[id]!
  node.position = pos
  if (node.opId === GROUP_OP_ID) {
    const groupId = typeof node.params.groupId === 'string' ? node.params.groupId : node.id
    const grp = after.groups?.[groupId]
    if (grp) grp.position = { ...pos }
  }
  const size = estimateNodeSize(node, after, registry)
  placedRects.set(id, { x: pos.x, y: pos.y, ...size })
}

function flowCenterY(placedRects: ReadonlyMap<string, Rect>): number {
  if (placedRects.size === 0) return 0
  let sum = 0
  for (const r of placedRects.values()) sum += centerY(r)
  return sum / placedRects.size
}

/**
 * Place nodes created without explicit `position` in this batch. Mutates
 * `after.nodes[...].position` in place. Never touches nodes outside `autoIds`
 * or nodes that existed before the batch.
 */
export function layoutIncrementalNewNodes(
  before: GraphFileV1,
  after: GraphFileV1,
  ops: readonly LayoutTrackableOp[],
  registry?: OpRegistry,
): void {
  const autoIds = collectAutoLayoutNodeIds(ops)
  if (autoIds.size === 0) return

  const existingIds = new Set(Object.keys(before.nodes))
  const toLayout = [...autoIds].filter((id) => after.nodes[id] !== undefined && !existingIds.has(id))
  if (toLayout.length === 0) return

  const opIndex = opCreationIndex(ops)
  const anchoredOrder = sortForPlacement(
    toLayout.filter((id) => touchesExisting(id, after, existingIds)),
    after,
    autoIds,
    opIndex,
  )
  const placedRects = new Map<string, Rect>()

  const fixedObstacles = (): Rect[] => {
    const rects: Rect[] = []
    for (const [id, node] of Object.entries(after.nodes)) {
      if (autoIds.has(id) && !placedRects.has(id)) continue
      rects.push(placedRects.get(id) ?? nodeRect(node, after, registry))
    }
    return rects
  }

  const rectForId = (id: string): Rect => {
    const placed = placedRects.get(id)
    if (placed) return placed
    const node = after.nodes[id]
    if (!node) return { x: 0, y: 0, w: DEFAULT_BATTERY_W, h: DEFAULT_BATTERY_H }
    return nodeRect(node, after, registry)
  }

  // Pass 1 — nodes connected to the existing graph (main data-flow band).
  for (const id of anchoredOrder) {
    const node = after.nodes[id]!
    const size = estimateNodeSize(node, after, registry)

    const inFromExisting = Object.values(after.edges).filter(
      (e) => e.target.nodeId === id && existingIds.has(e.source.nodeId),
    )
    const inFromPlacedNew = Object.values(after.edges).filter(
      (e) => e.target.nodeId === id && autoIds.has(e.source.nodeId) && placedRects.has(e.source.nodeId),
    )
    const outToExisting = Object.values(after.edges).filter(
      (e) => e.source.nodeId === id && existingIds.has(e.target.nodeId),
    )

    let pos: Position | undefined

    if (inFromExisting.length > 0 || inFromPlacedNew.length > 0) {
      const parentId = (inFromExisting[0] ?? inFromPlacedNew[0])!.source.nodeId
      pos = placeFromParent(id, rectForId(parentId), parentId, after, autoIds, opIndex, registry)
    } else if (outToExisting.length > 0) {
      const targetId = outToExisting[0]!.target.nodeId
      const targetRect = rectForId(targetId)
      const feeders = feedersToTarget(targetId, after, autoIds, opIndex)
      const slot = feeders.indexOf(id)
      const feederHeights = feeders.map((f) => estimateNodeSize(after.nodes[f]!, after, registry).h)
      pos = {
        x: targetRect.x - COL_GAP - size.w,
        y: stackSlotY(slot, feeders.length, feederHeights, centerY(targetRect)),
      }
    }

    if (!pos) continue
    pos.y = resolveVerticalCollision(pos.x, pos.y, size, fixedObstacles())
    applyPosition(after, id, pos, placedRects, registry)
  }

  const flowY = placedRects.size > 0 ? flowCenterY(placedRects) : 0
  const afterPass1 = fixedNodeBounds(after, autoIds, placedRects, registry)
  let horizCursorX = afterPass1.any ? afterPass1.maxRight + COL_GAP : 0
  const expansionColumnX = horizCursorX
  let expansionStackY = flowY

  // Pass 2 — disconnected new-only nodes: extend RIGHT on the flow row, or
  // stack vertically in one far-right column (never wrap below the graph).
  const components = newOnlyComponents(toLayout, after, existingIds)
  for (const comp of components) {
    if (comp.length === 1) {
      const id = comp[0]!
      const size = estimateNodeSize(after.nodes[id]!, after, registry)
      const y = resolveVerticalCollision(
        expansionColumnX,
        expansionStackY - size.h / 2,
        size,
        fixedObstacles(),
      )
      applyPosition(after, id, { x: expansionColumnX, y }, placedRects, registry)
      expansionStackY = y + size.h + ROW_GAP
      continue
    }

    if (isLinearChainComponent(comp, after)) {
      const { positions, endX } = layoutLinearChainAtY(
        comp,
        after,
        autoIds,
        opIndex,
        registry,
        horizCursorX,
        flowY,
      )
      for (const id of comp) {
        const pos = positions.get(id)!
        const size = estimateNodeSize(after.nodes[id]!, after, registry)
        const y = resolveVerticalCollision(pos.x, pos.y, size, fixedObstacles())
        applyPosition(after, id, { x: pos.x, y }, placedRects, registry)
      }
      horizCursorX = endX + COL_GAP
      continue
    }

    const order = sortForPlacement(comp, after, autoIds, opIndex)
    for (const id of order) {
      const node = after.nodes[id]!
      const size = estimateNodeSize(node, after, registry)
      const inInternal = Object.values(after.edges).filter(
        (e) => e.target.nodeId === id && comp.includes(e.source.nodeId) && placedRects.has(e.source.nodeId),
      )
      let pos: Position
      if (inInternal.length > 0) {
        const parentId = inInternal[0]!.source.nodeId
        pos = placeFromParent(id, rectForId(parentId), parentId, after, autoIds, opIndex, registry)
      } else {
        pos = { x: horizCursorX, y: flowY - size.h / 2 }
      }
      pos.y = resolveVerticalCollision(pos.x, pos.y, size, fixedObstacles())
      applyPosition(after, id, pos, placedRects, registry)
    }
    horizCursorX = fixedNodeBounds(after, autoIds, placedRects, registry).maxRight + COL_GAP
  }
}
