// Agent-facing projection of a pipeline ExecutionResult.
//
// The REST route /api/v1/execute (routes/execute.ts) intentionally returns the
// FULL ExecutionResult — every node/port carries its DataTreeEntry[] wire value,
// and a scene port's items embed the entire SceneGraph (ScenePortValue{graph,focus})
// with all voxel content. For a real graph that is ~28MB (single port up to
// ~1.7MB). UI and other REST callers may depend on the full payload, so the
// route stays as-is.
//
// But the agent tool `scene:pipeline.execute` must NOT pour that into the model's
// context. This module projects the full result into a KB-scale summary that keeps
// exactly what sino needs to verify "did each group produce output":
//   - top-level status / error / durationMs (unchanged — sino judges success on these)
//   - per node/port: branch & item counts, child names, voxel cell counts, and
//     mesh/triangle counts (never the geometry payload itself).
//
// The projection is defensive: any unexpected port shape collapses to a safe note
// instead of throwing, so one malformed port can never break the whole summary.
//
// 2026-07-01 新增：可选的 `expectedLocationNames` 入参 — 上游叙事/契约地点名列表。
// 当调用方（aw-support/Sino，经 scene:pipeline.execute 的 narrativeLocationNames 参数）
// 提供了这份名单，本模块会把已经收集到的 childNames/descendantNames（本就是
// sino 判断"每组是否产出"的信号）拿来同时跑一遍 stage3.location_names 硬门控
// （见 lib/locationNameGate.ts），并把结果写进 `verification.locationNameAlignment`
// + 追加进 `verification.hints`——不通过就在摘要里给出结构化缺失清单，而不是让
// 命名对齐仅仅停留在 prompt 文档里的"应该"。

import { checkLocationNameAlignment } from './lib/locationNameGate.js'
import {
  cellCount,
  childrenOf,
  getNode,
  parseScenePort,
  pathOf,
  type SceneGraph,
  type SceneNode,
} from '../../vendor/dist/shared/types/scene/index.js'

function normalizeEdgePort(port: unknown): string | undefined {
  if (typeof port === 'string') return port
  if (port && typeof port === 'object') {
    const rec = port as { portName?: unknown; label?: unknown }
    if (typeof rec.portName === 'string') return rec.portName
    if (typeof rec.label === 'string') return rec.label
  }
  return undefined
}

/** Mirrors `@forgeax/node-runtime` ExecutionResult (kept local to avoid a dep). */
export interface ExecutionResult {
  executionId: string
  status: 'completed' | 'error' | 'aborted'
  outputs: Record<string, Record<string, unknown>>
  error?: { nodeId?: string; message: string }
  durationMs: number
}

export interface SpatialTelemetry {
  worldBounds: {
    min: [number, number, number]
    max: [number, number, number]
    size: [number, number, number]
  }
  elevation: {
    min: number
    max: number
    relief: number
    verticalAspect: string
  }
  slope: {
    meanAngleDeg: number
    maxAngleDeg: number
    steepAreaPercent: string
  }
  sampling: {
    meshCount: number
    vertexCount: number
    triangleCount: number
  }
}

// Above this many cells/items we replace the array with a count and stop walking
// into individual elements. Small scalar/string/number ports pass through as-is.
const MAX_INLINE_ITEMS = 8
// A scalar string item longer than this is replaced by a shape note instead of
// being inlined. Guards against image/data-URI ports (2D asset app) and other
// large text payloads bloating the summary — sino only needs the shape, not the
// bytes. (Tier-4 spill in host_tool_bridge is the backstop if a summary still
// somehow grows large; this keeps the common case lean at the source.)
const MAX_STRING_CHARS = 256
const MAX_CHILD_NAMES = 64
// Cap on unique descendant names collected per scene subtree. Names are the key
// signal sino uses to verify "which assets/groups got produced" (the SKILL jq
// `[.. | objects | select(has("name")) | .name] | unique`), and real graphs nest
// the asset names a couple levels below the focus root — so we collect uniquely
// across the subtree, not just direct children. Bounded to stay KB-scale.
const MAX_DESCENDANT_NAMES = 80

/** A scene node snapshot's lightweight summary: name + schema + cell count + child names. */
interface SceneNodeSummary {
  name?: string
  path?: string
  schema?: string
  /** Cells on this node only (not descendants). */
  cellCount: number
  /** Total cells in this node's whole subtree (self + descendants). */
  subtreeCellCount: number
  /** Mesh nodes in this node's whole subtree. */
  subtreeMeshCount: number
  /** Triangles in this node's whole subtree. */
  subtreeTriangleCount: number
  childCount: number
  /** Direct child names — sino's primary "what did this group produce" signal. */
  childNames?: string[]
  /** Unique node names anywhere in the subtree (bounded) — surfaces nested asset names. */
  descendantNames?: string[]
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function isRawMeshPayload(val: unknown): val is { positions: number[]; indices: number[] } {
  if (!isRecord(val)) return false
  const positions = val.positions
  const indices = val.indices
  return Array.isArray(positions) && Array.isArray(indices) && positions.length >= 9 && indices.length >= 3
}

function unwrapPayloadItems(val: unknown, depth = 0): unknown[] {
  if (val === null || val === undefined || depth > 8) return []
  if (Array.isArray(val)) {
    const out: unknown[] = []
    for (const entry of val) {
      if (entry && typeof entry === 'object' && Array.isArray((entry as { items?: unknown[] }).items)) {
        out.push(...unwrapPayloadItems((entry as { items: unknown[] }).items, depth + 1))
      } else {
        out.push(...unwrapPayloadItems(entry, depth + 1))
      }
    }
    return out
  }
  if (typeof val === 'object' && val !== null && Array.isArray((val as { items?: unknown[] }).items)) {
    return unwrapPayloadItems((val as { items: unknown[] }).items, depth + 1)
  }
  return [val]
}

function collectMeshesFromOutputs(outputs: Record<string, unknown>): Array<{ positions: number[]; indices: number[] }> {
  const meshes: Array<{ positions: number[]; indices: number[] }> = []
  const seenMeshes = new WeakSet<object>()

  for (const ports of Object.values(outputs)) {
    if (!isRecord(ports)) continue
    for (const portVal of Object.values(ports)) {
      const items = unwrapPayloadItems(portVal)
      for (const item of items) {
        if (!isRecord(item)) continue

        // 1. ScenePort value: { graph, focus }
        const port = parseScenePort(item)
        if (port && port.graph) {
          for (const node of port.graph.values()) {
            const content = node.content
            if (!isRecord(content)) continue
            const mesh = 'mesh' in content ? content.mesh : undefined
            if (isRecord(mesh) && isRawMeshPayload(mesh) && !seenMeshes.has(mesh)) {
              seenMeshes.add(mesh)
              meshes.push(mesh)
            }
          }
        }

        // 2. Direct mesh payload
        const meshWrapper = item.mesh
        if (isRecord(meshWrapper) && isRawMeshPayload(meshWrapper) && !seenMeshes.has(meshWrapper)) {
          seenMeshes.add(meshWrapper)
          meshes.push(meshWrapper)
        } else if (isRawMeshPayload(item) && !seenMeshes.has(item)) {
          seenMeshes.add(item)
          meshes.push(item)
        }
      }
    }
  }

  return meshes
}

export function computeSpatialTelemetry(outputs: Record<string, unknown>): SpatialTelemetry | undefined {
  const meshes = collectMeshesFromOutputs(outputs)
  if (meshes.length === 0) return undefined

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let totalVertices = 0
  let totalTriangles = 0

  let totalSlopeDeg = 0
  let maxSlopeDeg = 0
  let steepTriangles = 0
  let evaluatedTriangles = 0

  for (const mesh of meshes) {
    const pos = mesh.positions
    const ind = mesh.indices
    totalVertices += Math.floor(pos.length / 3)
    const triCount = Math.floor(ind.length / 3)
    totalTriangles += triCount

    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i]!
      const y = pos[i + 1]!
      const z = pos[i + 2]!
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }

    const step = triCount > 20000 ? Math.ceil(triCount / 10000) : 1
    for (let t = 0; t < ind.length; t += 3 * step) {
      const i0 = ind[t]! * 3
      const i1 = ind[t + 1]! * 3
      const i2 = ind[t + 2]! * 3
      if (i0 + 2 >= pos.length || i1 + 2 >= pos.length || i2 + 2 >= pos.length) continue

      const ax = pos[i1]! - pos[i0]!
      const ay = pos[i1 + 1]! - pos[i0 + 1]!
      const az = pos[i1 + 2]! - pos[i0 + 2]!

      const bx = pos[i2]! - pos[i0]!
      const by = pos[i2 + 1]! - pos[i0 + 1]!
      const bz = pos[i2 + 2]! - pos[i0 + 2]!

      const nx = ay * bz - az * by
      const ny = az * bx - ax * bz
      const nz = ax * by - ay * bx
      const len = Math.hypot(nx, ny, nz)
      if (len > 1e-6) {
        const cosTheta = Math.min(1, Math.abs(nz) / len)
        const slopeDeg = (Math.acos(cosTheta) * 180) / Math.PI
        totalSlopeDeg += slopeDeg
        if (slopeDeg > maxSlopeDeg) maxSlopeDeg = slopeDeg
        if (slopeDeg >= 60) steepTriangles++
        evaluatedTriangles++
      }
    }
  }

  if (!Number.isFinite(minX)) return undefined

  const sizeX = Math.round((maxX - minX) * 10) / 10
  const sizeY = Math.round((maxY - minY) * 10) / 10
  const sizeZ = Math.round((maxZ - minZ) * 10) / 10
  // Authoring metres are Z-up: X east, Y south, Z elevation.
  const horizontalSpan = Math.max(sizeX, sizeY)
  const relief = sizeZ

  const verticalAspectPct = horizontalSpan > 0
    ? `${((relief / horizontalSpan) * 100).toFixed(1)}% (relief ${Math.round(relief)}m / span ${Math.round(horizontalSpan)}m)`
    : '0%'

  const meanSlope = evaluatedTriangles > 0 ? Number((totalSlopeDeg / evaluatedTriangles).toFixed(1)) : 0
  const maxSlope = Number(maxSlopeDeg.toFixed(1))
  const steepAreaPercent = evaluatedTriangles > 0
    ? `${((steepTriangles / evaluatedTriangles) * 100).toFixed(1)}% (>= 60 deg)`
    : '0%'

  return {
    worldBounds: {
      min: [Math.round(minX * 10) / 10, Math.round(minY * 10) / 10, Math.round(minZ * 10) / 10],
      max: [Math.round(maxX * 10) / 10, Math.round(maxY * 10) / 10, Math.round(maxZ * 10) / 10],
      size: [sizeX, sizeY, sizeZ],
    },
    elevation: {
      min: Math.round(minZ * 10) / 10,
      max: Math.round(maxZ * 10) / 10,
      relief: Math.round(relief * 10) / 10,
      verticalAspect: verticalAspectPct,
    },
    slope: {
      meanAngleDeg: meanSlope,
      maxAngleDeg: maxSlope,
      steepAreaPercent,
    },
    sampling: {
      meshCount: meshes.length,
      vertexCount: totalVertices,
      triangleCount: totalTriangles,
    },
  }
}

function meshTriangleCount(node: SceneNode): number {
  const content: unknown = node.content
  if (!isRecord(content) || content.schema !== 'mesh' || !isRecord(content.mesh)) return 0
  return meshPayloadTriangleCount(content.mesh)
}

/** Count triangles on a raw `mesh` port payload, not only scene-graph nodes. */
function meshPayloadTriangleCount(item: unknown): number {
  if (!isRecord(item)) return 0
  const mesh = isRecord(item.mesh) && Array.isArray((item.mesh as { indices?: unknown }).indices)
    ? item.mesh
    : item
  if (!isRecord(mesh)) return 0
  const indices = mesh.indices
  if (Array.isArray(indices) && indices.length >= 3) return Math.floor(indices.length / 3)
  const positions = mesh.positions
  return Array.isArray(positions) && positions.length >= 9 ? Math.floor(positions.length / 9) : 0
}

function countSubtreeMeshes(
  graph: SceneGraph,
  node: SceneNode,
  visited: WeakSet<object> = new WeakSet(),
): { meshes: number; triangles: number } {
  if (visited.has(node)) return { meshes: 0, triangles: 0 }
  visited.add(node)
  const ownTriangles = meshTriangleCount(node)
  let meshes = ownTriangles > 0 ? 1 : 0
  let triangles = ownTriangles
  for (const child of childrenOf(graph, node.id)) {
    const childCount = countSubtreeMeshes(graph, child, visited)
    meshes += childCount.meshes
    triangles += childCount.triangles
  }
  return { meshes, triangles }
}

/**
 * Count cells across a graph subtree (self + all descendants), starting at
 * `node`. Defensive.
 *
 * 复盘(2026-07-01 循环引用死循环事故):旧 SceneNodeSnapshot 版本这里是无环防护
 * 的裸递归——若树里出现结构性循环引用(baked-scene.json 观测到的 ~9.7 亿次迭代
 * 死循环),会直接栈溢出或长时间挂死整个执行摘要计算,拖垮 backend。v3 的
 * SceneGraph 是 ID-addressed 持久化 map，每个 NodeId 在构造时就固定了唯一
 * parent（见 graph.ts），结构上不可能再产生环——但这里仍保留 `visited` 纵深
 * 防御层，不依赖"新模型不会环"这份保证本身：再次撞到同一节点直接短路返回 0，
 * 把"万一有环"降级成"该子树按 0 计，摘要偏小但绝不挂死"。
 */
function countSubtreeCells(graph: SceneGraph, node: SceneNode, visited: WeakSet<object> = new WeakSet()): number {
  if (visited.has(node)) return 0
  visited.add(node)
  let n = node.content ? cellCount(node.content) : 0
  for (const child of childrenOf(graph, node.id)) n += countSubtreeCells(graph, child, visited)
  return n
}

/**
 * Collect unique node names across a subtree (breadth-first, bounded). The root
 * itself is skipped (its name is reported separately); we want the descendant
 * asset/group names sino verifies against (e.g. "architecture_0", "rest", "石路").
 * Stops once `out` reaches MAX_DESCENDANT_NAMES so a huge tree stays KB-scale.
 */
function collectDescendantNames(graph: SceneGraph, root: SceneNode): string[] {
  const seen = new Set<string>()
  // 复盘(2026-07-01):原实现只靠 `seen.size < MAX_DESCENDANT_NAMES` 兜底——如果环上
  // 的节点全同名(seen.size 卡在 1 不再增长)或环很大,queue 会被同一批节点反复
  // push 到无界增长,MAX_DESCENDANT_NAMES 根本拦不住,照样 OOM/挂死。额外用
  // `visitedRefs` 记对象引用去重,任何节点只下探一次,双重兜底（v3 结构上不会环，
  // 但同一份深防御原则延续下来，见 countSubtreeCells 同款注释）。
  const visitedRefs = new WeakSet<object>()
  const queue: SceneNode[] = [...childrenOf(graph, root.id)]
  while (queue.length > 0 && seen.size < MAX_DESCENDANT_NAMES) {
    const node = queue.shift()
    if (!node) continue
    if (visitedRefs.has(node)) continue
    visitedRefs.add(node)
    if (node.name.length > 0) seen.add(node.name)
    for (const child of childrenOf(graph, node.id)) queue.push(child)
  }
  return [...seen]
}

/** Summarize a SceneNode within its graph (the focus of a scene port value). Never throws. */
function summarizeSceneNode(graph: SceneGraph, node: SceneNode): SceneNodeSummary {
  const children = childrenOf(graph, node.id)
  const childNames = children.map((c) => c.name).slice(0, MAX_CHILD_NAMES)
  const geometry = countSubtreeMeshes(graph, node)
  const summary: SceneNodeSummary = {
    cellCount: node.content ? cellCount(node.content) : 0,
    subtreeCellCount: countSubtreeCells(graph, node),
    subtreeMeshCount: geometry.meshes,
    subtreeTriangleCount: geometry.triangles,
    childCount: children.length,
  }
  if (node.name) summary.name = node.name
  const path = pathOf(graph, node.id)
  if (path) summary.path = path
  if (node.schema) summary.schema = node.schema
  if (childNames.length > 0) summary.childNames = childNames
  const descendantNames = collectDescendantNames(graph, node)
  if (descendantNames.length > 0) summary.descendantNames = descendantNames
  return summary
}

/**
 * Summarize a single item inside a DataTreeEntry.items array. An item is the
 * actual wire payload for one branch element:
 *   - scene port  → ScenePortValue `{ graph: SceneGraph, focus: NodeId }`
 *   - string/number/boolean → the scalar (small → kept as-is)
 *   - grid        → nested arrays (huge → replaced by a shape note)
 *   - other arrays/objects → shape note with a length/size
 */
function summarizeItem(item: unknown): unknown {
  // Scene port value: { graph, focus } — parseScenePort accepts both the live
  // in-process SceneGraph (this module always runs on the raw in-process
  // ExecutionResult, never a JSON round-trip) and, defensively, a wire-revived
  // one, so this one call replaces the old hand-written `.tree`/`.children`
  // duck-typing entirely.
  const port = parseScenePort(item)
  if (port) {
    const node = getNode(port.graph, port.focus)
    return {
      focus: port.focus,
      tree: node ? summarizeSceneNode(port.graph, node) : { cellCount: 0, subtreeCellCount: 0, childCount: 0 },
    }
  }
  // Long strings (image data URIs, base64, big text) → shape note, never inlined.
  if (typeof item === 'string' && item.length > MAX_STRING_CHARS) {
    return { kind: 'string', length: item.length }
  }
  // Small scalars pass through unchanged (string/number/boolean/null).
  if (item === null || typeof item !== 'object') return item
  // Arrays (e.g. grid 2D arrays, raw cell lists) — never inline; just shape it.
  if (Array.isArray(item)) {
    return { kind: 'array', length: item.length }
  }
  // Unknown object: report scalar values (numbers, booleans, bounded strings) and keys
  // so Sino can read metric outputs, test measurements, and status scalars directly without hacking throw new Error.
  const obj = item as Record<string, unknown>
  const scalarProps: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number' || typeof v === 'boolean') {
      scalarProps[k] = v
    } else if (typeof v === 'string' && v.length <= MAX_STRING_CHARS) {
      scalarProps[k] = v
    }
  }
  return {
    kind: 'object',
    ...scalarProps,
    keys: Object.keys(obj).slice(0, 32),
  }
}

/** A summarized port: branch/item counts + per-item lightweight summaries. */
interface PortSummary {
  /** Number of DataTree branches (entries). */
  branchCount: number
  /** Total items across all branches. */
  itemCount: number
  /** Total voxel cells across every scene item in this port (subtree-wide). */
  totalCellCount: number
  /** Total non-empty mesh nodes across every scene item in this port. */
  totalMeshCount: number
  /** Total mesh triangles across every scene item in this port. */
  totalTriangleCount: number
  /** Per-item summaries (capped; if more, a `truncated` flag is set). */
  items: unknown[]
  truncated?: boolean
}

/** Count cells emitted by scene_output's voxel_layers port without retaining payloads. */
function countVoxelLayerCells(item: unknown): number {
  const layers = Array.isArray(item) ? item : [item]
  return layers.reduce((total, layer) => {
    if (!isRecord(layer) || !Array.isArray(layer.cells)) return total
    return total + layer.cells.length
  }, 0)
}

/** Count mesh stats scene_output stamps onto name_list when the scene port is omitted. */
function countNamedMeshGeometry(item: unknown): { meshes: number; triangles: number } {
  if (Array.isArray(item)) {
    return item.reduce(
      (total, entry) => {
        const geometry = countNamedMeshGeometry(entry)
        return { meshes: total.meshes + geometry.meshes, triangles: total.triangles + geometry.triangles }
      },
      { meshes: 0, triangles: 0 },
    )
  }
  if (!isRecord(item) || typeof item.triangleCount !== 'number' || item.triangleCount <= 0) {
    return { meshes: 0, triangles: 0 }
  }
  const meshes = typeof item.meshCount === 'number' && item.meshCount > 0 ? item.meshCount : 1
  return { meshes, triangles: item.triangleCount }
}

function formatExecFailure(item: unknown): string {
  if (typeof item === 'string') return item
  try {
    return JSON.stringify(item) ?? String(item)
  } catch {
    return String(item)
  }
}

/** Summarize one port wire value (DataTreeEntry[] toJSON form). Never throws. */
function summarizePort(value: unknown): unknown {
  // Expected shape: DataTreeEntry[] = [{ path, items }, ...]
  if (!Array.isArray(value)) {
    // Unexpected (non-array) port value — report shape only.
    if (value === null || typeof value !== 'object') return { value }
    return { kind: 'object', keys: Object.keys(value as object).slice(0, 32) }
  }
  const summaries: unknown[] = []
  let itemCount = 0
  let totalCellCount = 0
  let totalMeshCount = 0
  let totalTriangleCount = 0
  let truncated = false
  for (const entry of value) {
    const items = isRecord(entry) && Array.isArray(entry.items) ? entry.items : []
    itemCount += items.length
    for (const item of items) {
      // Tally cells regardless of whether we inline this item's summary.
      const port = parseScenePort(item)
      if (port) {
        const node = getNode(port.graph, port.focus)
        if (node) {
          totalCellCount += countSubtreeCells(port.graph, node)
          const geometry = countSubtreeMeshes(port.graph, node)
          totalMeshCount += geometry.meshes
          totalTriangleCount += geometry.triangles
        }
      } else {
        const triangles = meshPayloadTriangleCount(item)
        if (triangles > 0) {
          totalMeshCount += 1
          totalTriangleCount += triangles
        } else {
          const named = countNamedMeshGeometry(item)
          totalMeshCount += named.meshes
          totalTriangleCount += named.triangles
          if (named.meshes === 0) totalCellCount += countVoxelLayerCells(item)
        }
      }
      if (summaries.length < MAX_INLINE_ITEMS) {
        const path = isRecord(entry) && Array.isArray(entry.path) ? entry.path : undefined
        summaries.push({ ...(path ? { path } : {}), ...(summarizeItemAsObject(item)) })
      } else {
        truncated = true
      }
    }
  }
  const out: PortSummary = {
    branchCount: value.length,
    itemCount,
    totalCellCount,
    totalMeshCount,
    totalTriangleCount,
    items: summaries,
  }
  if (truncated) out.truncated = true
  return out
}

/** Wrap summarizeItem so a scalar item still nests under a `value` key for consistency. */
function summarizeItemAsObject(item: unknown): Record<string, unknown> {
  const s = summarizeItem(item)
  return isRecord(s) ? s : { value: s }
}

/**
 * Walk the ALREADY-SUMMARIZED outputs tree and collect every scene node name
 * that appears anywhere (`name` / `childNames` / `descendantNames` fields).
 * This is the "final baked/executed scene graph's set of node names" the
 * location-name gate compares the upstream narrative names against — sourced
 * from the summary (not the raw ExecutionResult) so it stays cheap and never
 * re-walks the potentially-huge scene trees a second time.
 */
function collectSceneNodeNamesFromSummary(summarizedOutputs: Record<string, Record<string, unknown>>): string[] {
  const names = new Set<string>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const v of value) visit(v)
      return
    }
    if (!isRecord(value)) return
    if (typeof value.name === 'string' && value.name.length > 0) names.add(value.name)
    if (Array.isArray(value.childNames)) {
      for (const n of value.childNames) if (typeof n === 'string') names.add(n)
    }
    if (Array.isArray(value.descendantNames)) {
      for (const n of value.descendantNames) if (typeof n === 'string') names.add(n)
    }
    for (const v of Object.values(value)) visit(v)
  }
  visit(summarizedOutputs)
  return [...names]
}

/**
 * Project a full ExecutionResult into a KB-scale summary for the AI tool layer.
 * status / error / executionId / durationMs are preserved verbatim. `outputs`
 * is projected node-by-node, port-by-port into child names + cell counts, never
 * the raw cells.
 *
 * `expectedLocationNames` (optional): external location-contract entity names.
 * When supplied and non-empty,
 * this runs `checkLocationNameAlignment` against every node name collected from
 * `outputs` and reports the result under `verification.locationNameAlignment`.
 */

function portMeshGeometry(summary: unknown): { meshes: number; triangles: number } {
  if (!isRecord(summary)) return { meshes: 0, triangles: 0 }
  return {
    meshes: typeof summary.totalMeshCount === 'number' ? summary.totalMeshCount : 0,
    triangles: typeof summary.totalTriangleCount === 'number' ? summary.totalTriangleCount : 0,
  }
}

/**
 * Optional sceneOutput often omits its passthrough `scene` port from execute outputs.
 * Mesh geometry then lives on the wired source (Geometry mesh ports, leftover scene ports).
 */
function meshGeometryOutsideCaptures(
  summarizedOutputs: Record<string, Record<string, unknown>>,
  captureIds: readonly string[],
  currentGraph?: { edges: readonly { source?: { nodeId?: string; port?: unknown }; target?: { nodeId?: string; port?: unknown } }[] },
): { meshes: number; triangles: number } {
  const captures = new Set(captureIds)
  const addPorts = (nodeId: string, portName?: string): { meshes: number; triangles: number } => {
    const ports = summarizedOutputs[nodeId]
    if (!ports) return { meshes: 0, triangles: 0 }
    if (portName) return portMeshGeometry(ports[portName])
    return Object.values(ports).reduce<{ meshes: number; triangles: number }>(
      (total, summary) => {
        const geometry = portMeshGeometry(summary)
        return { meshes: total.meshes + geometry.meshes, triangles: total.triangles + geometry.triangles }
      },
      { meshes: 0, triangles: 0 },
    )
  }
  if (currentGraph?.edges?.length) {
    let meshes = 0
    let triangles = 0
    for (const edge of currentGraph.edges) {
      if (!captures.has(edge.target?.nodeId ?? '')) continue
      const targetPort = normalizeEdgePort(edge.target?.port)
      if (targetPort && targetPort !== 'scene') continue
      const sourceId = edge.source?.nodeId
      if (!sourceId || captures.has(sourceId)) continue
      const geometry = addPorts(sourceId, normalizeEdgePort(edge.source?.port))
      meshes += geometry.meshes
      triangles += geometry.triangles
    }
    if (meshes > 0) return { meshes, triangles }
  }
  let meshes = 0
  let triangles = 0
  for (const [nodeId, ports] of Object.entries(summarizedOutputs)) {
    if (captures.has(nodeId)) continue
    for (const summary of Object.values(ports)) {
      const geometry = portMeshGeometry(summary)
      meshes += geometry.meshes
      triangles += geometry.triangles
    }
  }
  return { meshes, triangles }
}

export function summarizeExecutionResult(
  full: unknown,
  expectedLocationNames?: readonly string[],
  currentGraph?: { edges: readonly { source?: { nodeId?: string; port?: unknown }; target?: { nodeId?: string; port?: unknown } }[] },
  resultEntityIds?: readonly string[],
): unknown {
  if (!isRecord(full)) return full
  const summarizedOutputs: Record<string, Record<string, unknown>> = {}
  const outputs = isRecord(full.outputs) ? full.outputs : {}
  let totalSceneCells = 0
  let totalSceneMeshes = 0
  let totalSceneTriangles = 0
  for (const [nodeId, ports] of Object.entries(outputs)) {
    if (!isRecord(ports)) continue
    const portSummaries: Record<string, unknown> = {}
    for (const [portId, value] of Object.entries(ports)) {
      try {
        portSummaries[portId] = summarizePort(value)
        const ps = portSummaries[portId] as PortSummary
        if (typeof ps.totalCellCount === 'number') totalSceneCells += ps.totalCellCount
        if (typeof ps.totalMeshCount === 'number') totalSceneMeshes += ps.totalMeshCount
        if (typeof ps.totalTriangleCount === 'number') totalSceneTriangles += ps.totalTriangleCount
      } catch {
        portSummaries[portId] = { error: 'summary failed for this port' }
      }
    }
    summarizedOutputs[nodeId] = portSummaries
  }

  const status = full.status
  const structuralHints: string[] = []
  const executionHints: string[] = []
  /** Non-blocking notes (do NOT flip verification.ok). Concurrent construction
   *  leaves orphan/_explore scratch groups and other agents' WIP on the same
   *  project; those must not make an unrelated task's execute look failed. */
  const advisoryHints: string[] = []
  const canonicalSceneScript = resultEntityIds !== undefined
  const finalResultEntityIds = [...new Set(resultEntityIds ?? [])]
  const missingResultEntityIds = finalResultEntityIds.filter((nodeId) => !(nodeId in summarizedOutputs))
  const captureEmptyIds = finalResultEntityIds.filter((nodeId) => {
    const ports = summarizedOutputs[nodeId]
    return ports ? Object.values(ports).every((summary) => {
      const port = summary as Partial<PortSummary>
      return (port.totalCellCount ?? 0) === 0 && (port.totalMeshCount ?? 0) === 0
    }) : false
  })
  const upstreamMeshGeometry = canonicalSceneScript
    ? meshGeometryOutsideCaptures(summarizedOutputs, finalResultEntityIds, currentGraph)
    : { meshes: 0, triangles: 0 }
  const emptyResultEntityIds = captureEmptyIds.length && upstreamMeshGeometry.meshes > 0
    ? []
    : captureEmptyIds
  const finalSceneCells = finalResultEntityIds.reduce<number>((total, nodeId) => {
    const ports = summarizedOutputs[nodeId]
    return total + (ports ? Object.values(ports).reduce<number>((portTotal, summary) => {
      const count = (summary as Partial<PortSummary>).totalCellCount
      return portTotal + (typeof count === 'number' ? count : 0)
    }, 0) : 0)
  }, 0)
  const capturedSceneMeshes = finalResultEntityIds.reduce<number>((total, nodeId) => {
    const ports = summarizedOutputs[nodeId]
    return total + (ports ? Object.values(ports).reduce<number>((portTotal, summary) => {
      const count = (summary as Partial<PortSummary>).totalMeshCount
      return portTotal + (typeof count === 'number' ? count : 0)
    }, 0) : 0)
  }, 0)
  const capturedSceneTriangles = finalResultEntityIds.reduce<number>((total, nodeId) => {
    const ports = summarizedOutputs[nodeId]
    return total + (ports ? Object.values(ports).reduce<number>((portTotal, summary) => {
      const count = (summary as Partial<PortSummary>).totalTriangleCount
      return portTotal + (typeof count === 'number' ? count : 0)
    }, 0) : 0)
  }, 0)
  const finalSceneMeshes = capturedSceneMeshes > 0 ? capturedSceneMeshes : upstreamMeshGeometry.meshes
  const finalSceneTriangles = capturedSceneMeshes > 0 ? capturedSceneTriangles : upstreamMeshGeometry.triangles
  const finalOutputOk = finalResultEntityIds.length === 0
    ? emptyResultEntityIds.length === 0 && missingResultEntityIds.length === 0
    : emptyResultEntityIds.length === 0
      && missingResultEntityIds.length === 0
      && (finalSceneCells > 0 || finalSceneMeshes > 0)
  const rawExecFailures = Array.isArray((full as { execFailures?: unknown[] }).execFailures)
    ? (full as { execFailures: unknown[] }).execFailures
    : []
  const structuredFailures = Array.isArray((full as { failures?: unknown[] }).failures)
    ? (full as { failures: unknown[] }).failures.filter(isRecord).slice(0, 10)
    : []
  const execFailures = (structuredFailures.length > 0 ? structuredFailures : rawExecFailures)
    .map((failure) => isRecord(failure)
      ? `${typeof failure.nodeId === 'string' ? `${failure.nodeId}: ` : ''}${String(failure.message ?? 'execution failed')}`
      : formatExecFailure(failure))
    .map((item) => item.slice(0, 300))
  if (execFailures.length > 0) {
    executionHints.push(
      `[execution.failures] ${execFailures.length} node execution failure(s) were recorded; completed status is not acceptance. ` +
      'Fix the first failing Scene Script operation and re-execute.',
    )
  }
  if (canonicalSceneScript && finalResultEntityIds.length > 0 && status === 'completed' && !finalOutputOk) {
    structuralHints.push(
      `[scene-script.final-output] Compiled sceneOutput capture(s) produced no voxel cells or mesh geometry ` +
      `(resultEntityIds=${finalResultEntityIds.join(', ') || 'none'}). Intermediate output does not satisfy acceptance.`,
    )
  }

  if (!canonicalSceneScript && status === 'completed' && totalSceneCells === 0 && totalSceneMeshes === 0) {
    structuralHints.push(
      'execute completed but Default has no visible mesh, voxel, or grid. Select operating geometry, run the script, and expand structure.',
    )
  }

  const locationHints: string[] = []

  // stage3.location_names 硬门控（2026-07-01 新增，见 lib/locationNameGate.ts）：
  // 仅当调用方提供了非空的上游叙事/契约地点名单才跑（DEFAULT-OFF：
  // 没传名单就是没有上游契约可比对，
  // 不能瞎报缺失，也不影响未传该参数的既有调用方）。结果永远是结构化对象
  // （{ok, missing:[{name,reason}]}），从不是裸布尔，未命中同时并入上面的
  // `hints` 数组，让 Sino 在同一份摘要里看到全部需要修的问题。
  const hasExpectedNames = Array.isArray(expectedLocationNames) && expectedLocationNames.length > 0
  // 2026-07-10 复盘：这份候选名单本来就在这一步被收集出来了（比对缺失就是拿它跟
  // expectedLocationNames 做的），但从未回传给调用方——命名对齐失败时 sino 只知道
  // "缺了什么"，不知道"图里实际叫什么"，逼得 agent 只能反复调用 raw execute（几十
  // MB 的全量 ExecutionResult）去人工翻找输出节点的真实名字，卡在这一步来回试错。
  // 直接把已收集到的实际节点名（去重、排序、限量）随 rejection 一起吐出来，agent
  // 一次 summary 调用就能看到"预期 vs 实际"的对照，从源头消除这类摸黑重试。
  const MAX_ACTUAL_NAMES = 200
  const actualNodeNames = hasExpectedNames ? collectSceneNodeNamesFromSummary(summarizedOutputs) : []
  const locationRejection = hasExpectedNames
    ? checkLocationNameAlignment(expectedLocationNames!, actualNodeNames)
    : null
  if (locationRejection) {
    locationHints.push(
      `[stage3.location_names] ${locationRejection.reason} 缺失地点：${locationRejection.missing.map((m) => m.name).join('、')}。${locationRejection.fix} ` +
      '实际场景节点名见 verification.locationNameAlignment.actualNodeNames（无需再跑 raw execute 去翻找）。',
    )
  }

  let spatialTelemetry: SpatialTelemetry | undefined
  try {
    spatialTelemetry = computeSpatialTelemetry(outputs)
  } catch {
    spatialTelemetry = undefined
  }
  if (spatialTelemetry && totalSceneTriangles > 100) {
    const horizontalSpan = Math.max(spatialTelemetry.worldBounds.size[0], spatialTelemetry.worldBounds.size[2])
    if (horizontalSpan > 0 && spatialTelemetry.elevation.relief > horizontalSpan * 0.6) {
      advisoryHints.push(
        `[telemetry.vertical-aspect] Terrain vertical relief (${spatialTelemetry.elevation.relief}m) is ${spatialTelemetry.elevation.verticalAspect}. If fantasy/high-spire terrain is intended, this is valid; if realism was intended, verify if elevation scale matches your brief.`,
      )
    }
  }

  const hints = [...executionHints, ...structuralHints, ...locationHints, ...advisoryHints]
  const locationNamesOk = !locationRejection?.missing?.length
  const hasStructuralFailure = structuralHints.length > 0
  const hasExecutionFailure = execFailures.length > 0
  const hasLocationFailure = Boolean(locationRejection?.missing?.length)
  const primaryFailure: 'execution' | 'structural' | 'location-names' | undefined =
    hasExecutionFailure ? 'execution' : hasStructuralFailure ? 'structural' : hasLocationFailure ? 'location-names' : undefined

  return {
    executionId: full.executionId,
    status: full.status,
    durationMs: full.durationMs,
    ...(full.error !== undefined ? { error: full.error } : {}),
    ...(rawExecFailures.length > 0
      ? { execFailures: rawExecFailures }
      : {}),
    ...(structuredFailures.length > 0 ? { failures: structuredFailures } : {}),
    summarized: true,
    ...(spatialTelemetry ? { telemetry: spatialTelemetry, spatialTelemetry } : {}),
    verification: {
      ok: status === 'completed'
        && !hasExecutionFailure
        && structuralHints.length === 0
        && (!hasExpectedNames || locationNamesOk),
      totalSceneCells,
      totalSceneMeshes,
      totalSceneTriangles,
      ...(spatialTelemetry ? { spatialTelemetry } : {}),
      ...(canonicalSceneScript
        ? {
            finalOutput: {
              ok: finalOutputOk,
              resultEntityIds: finalResultEntityIds,
              totalSceneCells: finalSceneCells,
              totalSceneMeshes: finalSceneMeshes,
              totalSceneTriangles: finalSceneTriangles,
              missingResultEntityIds,
              emptyResultEntityIds,
            },
          }
        : {}),
      ...(hasExecutionFailure
        ? {
            executionFailures: {
              ok: false,
              count: execFailures.length,
              failures: execFailures.slice(0, 5).map((message, index) => ({ index, message })),
              ...(execFailures.length > 5 ? { truncated: true } : {}),
            },
          }
        : {}),
      ...(primaryFailure ? { primaryFailure } : {}),
      ...(hasExpectedNames
        ? {
            locationNameAlignment: locationRejection
              ? {
                  ok: false,
                  missing: locationRejection.missing,
                  fix: locationRejection.fix,
                  // 排序后限量输出，供 agent 直接肉眼/代码比对，不必再暴力刷 raw execute。
                  actualNodeNames: [...actualNodeNames].sort().slice(0, MAX_ACTUAL_NAMES),
                  ...(actualNodeNames.length > MAX_ACTUAL_NAMES ? { actualNodeNamesTruncated: true } : {}),
                }
              : { ok: true, missing: [] },
          }
        : {}),
      ...(hints.length > 0 ? { hints } : {}),
    },
    outputs: summarizedOutputs,
  }
}

const SCENE_SPATIAL_FAIL = new Set([
  'SCENE_GROUND_MISALIGNED',
  'SCENE_FRAME_MISALIGNED',
  'SCENE_MESH_INTERSECTS',
  'SCENE_GEOMETRY_DEGENERATE',
  'SCENE_ROAD_PAVEMENT_SPLIT',
  'SCENE_ROAD_GRADE_FAULT',
])

export function applySpatialVerification<T extends { verification?: Record<string, unknown> }>(
  summary: T,
  diagnostics: ReadonlyArray<{ code?: string; message?: string }>,
): T {
  const spatial = diagnostics.filter((item) => typeof item.code === 'string' && SCENE_SPATIAL_FAIL.has(item.code))
  if (spatial.length === 0) return summary
  const verification = { ...(summary.verification ?? {}) }
  const hints = Array.isArray(verification.hints) ? [...verification.hints] : []
  for (const item of spatial) {
    if (typeof item.message === 'string') hints.unshift(`[scene-script.placement] ${item.message}`)
  }
  return {
    ...summary,
    verification: {
      ...verification,
      ok: false,
      primaryFailure: verification.primaryFailure ?? 'spatial',
      hints,
    },
  }
}
