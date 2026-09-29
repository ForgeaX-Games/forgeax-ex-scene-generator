// Read-only queries over the editing API.
//
// Every query reads from layer1 storage; nothing here mutates state. UI /
// AI / CLI consumers should prefer these to direct GraphStore.load() so
// that the kernel can later swap in caching, projection, or auth without
// touching call-sites.

import type { GraphEdge, GraphNode, NodeGroup } from '../layer1/types/graph.js'
import type { OpSpec } from '../layer1/types/op-spec.js'
import type { HistoryEntryV1 } from '../layer1/storage/types.js'
import type { Runtime } from './runtime.js'

export interface NodeFilter {
  // Match by op id.
  opId?: string
  // Match by explicit node id list.
  ids?: readonly string[]
}

export interface HistoryQuery {
  sinceBatchId?: string
  limit?: number
}

export interface PipelineSnapshot {
  id: string
  hash: string
  createdAt: string
  updatedAt: string
  nodes: Record<string, GraphNode>
  edges: Record<string, GraphEdge>
  metadata?: Record<string, unknown>
}

export function getPipeline(runtime: Runtime): PipelineSnapshot | null {
  const g = runtime.graph.load()
  if (!g) return null
  return {
    id: g.id,
    hash: g.hash,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    nodes: g.nodes,
    edges: g.edges,
    metadata: g.metadata,
  }
}

/** Lightweight hash read for live-sync reconciler polls (no full snapshot). */
export function getPipelineHash(runtime: Runtime): string | null {
  const g = runtime.graph.load()
  return g?.hash ?? null
}

export interface NodeOutputMeta {
  executedHash: string
  valid: boolean
  sharded: boolean
  dataChunks?: number
}

/** Metadata-only output read — avoids reassembling sharded payloads. */
export function getNodeOutputMeta(runtime: Runtime, nodeId: string, portId: string): NodeOutputMeta | null {
  return runtime.outputs.readMeta(nodeId, portId)
}

export function getNode(runtime: Runtime, nodeId: string): GraphNode | null {
  const g = runtime.graph.load()
  return g?.nodes[nodeId] ?? null
}

/**
 * Locate a node by id ANYWHERE — at top level (graph.nodes) or as a member of a
 * group's inner sub-graph (graph.groups[*].nodes). Returns the node plus the
 * owning groupId when it lives inside a group, so callers (the AI run routes)
 * can address an inner manual-trigger battery (e.g. an `image_gen` packed into a
 * combined battery) the SAME way they address a top-level one: by its globally
 * unique node id. Top-level hits return `{ node }` (no groupId).
 */
export function findNodeWithGroup(
  runtime: Runtime,
  nodeId: string,
): { node: GraphNode; groupId?: string } | null {
  const g = runtime.graph.load()
  if (!g) return null
  const top = g.nodes[nodeId]
  if (top) return { node: top }
  for (const grp of Object.values(g.groups ?? {})) {
    const inner = grp.nodes.find((n) => n.id === nodeId)
    if (inner) return { node: inner, groupId: grp.id }
  }
  return null
}

export function listNodes(runtime: Runtime, filter?: NodeFilter): readonly GraphNode[] {
  const g = runtime.graph.load()
  if (!g) return []
  const all = Object.values(g.nodes)
  if (!filter) return all
  return all.filter((n) => {
    if (filter.opId !== undefined && n.opId !== filter.opId) return false
    if (filter.ids !== undefined && !filter.ids.includes(n.id)) return false
    return true
  })
}

export function listEdges(runtime: Runtime): readonly GraphEdge[] {
  const g = runtime.graph.load()
  if (!g) return []
  return Object.values(g.edges)
}

export function getNodeOutput(runtime: Runtime, nodeId: string, portId: string): unknown {
  const cached = runtime.outputs.read(nodeId, portId)
  return cached?.data
}

export function getHistory(runtime: Runtime, opts: HistoryQuery = {}): readonly HistoryEntryV1[] {
  const all = runtime.history.readAll()
  let start = 0
  if (opts.sinceBatchId !== undefined) {
    const idx = all.findIndex((e) => e.batchId === opts.sinceBatchId)
    if (idx >= 0) start = idx + 1
  }
  const slice = all.slice(start)
  return opts.limit !== undefined ? slice.slice(0, opts.limit) : slice
}

/**
 * Read a single group's sub-graph (member nodes, internal edges,
 * exposed input/output ports, name, position) from the flat registry.
 * Nested groups are first-class entries too, so a child group resolves
 * here by its own id (a parent references it via its __group__ inner
 * node's params.groupId). Returns null if the group does not exist or
 * no graph is loaded.
 */
export function getGroup(runtime: Runtime, groupId: string): NodeGroup | null {
  const g = runtime.graph.load()
  if (!g?.groups) return null
  return g.groups[groupId] ?? null
}

/**
 * List every group in the flat registry. Nested groups are first-class entries
 * here too; a parent references a child via its __group__ inner node's
 * params.groupId (the registry stays single-level — nesting is by reference).
 */
export function listGroups(runtime: Runtime): readonly NodeGroup[] {
  const g = runtime.graph.load()
  if (!g?.groups) return []
  return Object.values(g.groups)
}

// Serialisable projection of an OpSpec — every field the editor / CLI needs, minus the
// engine-only `execute` closure. Derived from OpSpec via Pick so it can never drift.
export type OpSummary = Pick<
  OpSpec,
  | 'id'
  | 'name'
  | 'nameEn'
  | 'description'
  | 'descriptionEn'
  | 'inputs'
  | 'outputs'
  | 'params'
  | 'dynamicInputs'
  | 'dynamicOutputs'
  | 'lacing'
  | 'principal'
  | 'manualTrigger'
>

// Stable read-only projection of every registered op, for UI palettes and CLI completion.
// Returns each OpSpec without its execute closure so the result stays serialisable.
export function listOps(runtime: Runtime): ReadonlyArray<OpSummary> {
  return runtime.registry
    .list()
    .map((spec) => ({
      id: spec.id,
      name: spec.name,
      nameEn: spec.nameEn,
      description: spec.description,
      descriptionEn: spec.descriptionEn,
      inputs: spec.inputs.map((i) => ({ ...i })),
      outputs: spec.outputs.map((o) => ({ ...o })),
      params: spec.params.map((p) => ({ ...p })),
      dynamicInputs: spec.dynamicInputs ? { ...spec.dynamicInputs } : undefined,
      dynamicOutputs: spec.dynamicOutputs ? { ...spec.dynamicOutputs } : undefined,
      lacing: spec.lacing,
      principal: spec.principal,
      manualTrigger: spec.manualTrigger,
    }))
}

/**
 * Per-inner-node output bag of a probed group sub-graph: innerNodeId -> { port -> value }.
 * Values are DataTreeEntry[] wire form (same shape as runtime.outputs / getNodeOutput).
 */
export type GroupInnerOutputs = Record<string, Record<string, unknown>>

/**
 * READ-ONLY probe of a group's INNER nodes so the editor's internal view can
 * show real data + types on the inner wires/ports instead of empty
 * "any / no result".
 *
 * It does NOT re-run anything. Last-run ports live in OutputCache under the
 * same ids as top-level nodes (inner node ids are globally unique). This query
 * reads those persisted values back per inner node + port. A port that has
 * never produced a value stays absent.
 *
 * Returns null when the group / graph is absent. Nested groups are handled the
 * same way: each nested level's inner nodes are persisted under their own ids
 * and read when the user enters THAT level (probed on its own id).
 */
export async function probeGroupInner(
  runtime: Runtime,
  groupId: string,
): Promise<GroupInnerOutputs | null> {
  const graph = runtime.graph.load()
  const group = graph?.groups?.[groupId]
  if (!graph || !group) return null

  const inner: GroupInnerOutputs = {}
  for (const node of group.nodes) {
    const bag: Record<string, unknown> = {}
    for (const port of runtime.outputs.listPorts(node.id)) {
      const data = runtime.outputs.read(node.id, port)?.data
      if (data !== undefined) bag[port] = data
    }
    if (Object.keys(bag).length > 0) inner[node.id] = bag
  }
  return inner
}

/** Discard every persisted execution cache entry under state/outputs/. */
export function clearOutputCache(runtime: Runtime): { ok: true } {
  runtime.outputs.clearAll()
  return { ok: true }
}
