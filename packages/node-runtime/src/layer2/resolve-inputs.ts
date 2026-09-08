// Pure graph helpers for execution: which nodes to run, in what order, and
// how to feed each node's inputs from already-produced upstream outputs.

import { topologicalSort } from '../layer1/index.js'
import type { GraphEdge, GraphNode } from '../layer1/index.js'

// Accumulated per-node output bags, keyed first by node id, then by output port name.
export type ProducedOutputs = ReadonlyMap<string, Record<string, unknown>>

// Read a cached upstream port value for nodes outside the execution closure.
export type CachedInputReader = (nodeId: string, port: string) => unknown

export function resolveNodeInputs(
  node: GraphNode,
  edges: readonly GraphEdge[],
  produced: ProducedOutputs,
  readCache?: CachedInputReader,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  for (const edge of edges) {
    if (edge.target.nodeId !== node.id) continue
    // This-run output wins; otherwise fall back to the persisted output cache so
    // a partial (downstream) run can read boundary upstream values that were
    // produced by an earlier execution and not re-run this pass. Mirrors the
    // legacy execution.service partial contract ("上游数据由后端 outputCache 补全").
    const upstream = produced.get(edge.source.nodeId)
    let value = upstream?.[edge.source.port]
    if (value === undefined && readCache) value = readCache(edge.source.nodeId, edge.source.port)
    if (value !== undefined) inputs[edge.target.port] = value
  }
  return inputs
}

export interface ExecutionClosure {
  // Node ids in dependency order.
  sorted: string[]
  // Lookup for the nodes in the closure.
  nodesById: Map<string, GraphNode>
  // All graph edges (the walk filters per node).
  edges: readonly GraphEdge[]
}

// Reverse-BFS: the node plus every node that feeds it (directly or transitively).
function upstreamOf(nodeId: string, edges: readonly GraphEdge[]): Set<string> {
  const visited = new Set<string>([nodeId])
  const queue = [nodeId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const edge of edges) {
      if (edge.target.nodeId === current && !visited.has(edge.source.nodeId)) {
        visited.add(edge.source.nodeId)
        queue.push(edge.source.nodeId)
      }
    }
  }
  return visited
}

export type BoundaryCacheReader = (nodeId: string, portId: string) => unknown

/**
 * Expand a partial downstream closure with upstream ancestors whose cached
 * outputs are missing. After output-cache retention prunes early-run const
 * nodes, boundary inputs would otherwise resolve empty and downstream
 * group/merge nodes fail (e.g. scene_merge_subtrees "not a valid ScenePortValue").
 */
export function expandClosureForMissingBoundaryCaches(
  nodes: Record<string, GraphNode>,
  edges: Record<string, GraphEdge>,
  closure: ExecutionClosure,
  readBoundaryCache: BoundaryCacheReader,
): ExecutionClosure {
  const allEdges = Object.values(edges)
  const inClosure = new Set(closure.sorted)
  const toAdd = new Set<string>()

  for (const edge of allEdges) {
    if (!inClosure.has(edge.target.nodeId)) continue
    if (inClosure.has(edge.source.nodeId)) continue
    if (readBoundaryCache(edge.source.nodeId, edge.source.port) !== undefined) continue
    for (const id of upstreamOf(edge.source.nodeId, allEdges)) {
      if (nodes[id]) toAdd.add(id)
    }
  }

  if (toAdd.size === 0) return closure

  const closureIds = [...new Set([...closure.sorted, ...toAdd])]
  const sorted = topologicalSort(closureIds, allEdges)
  if (sorted.length !== closureIds.length) {
    throw new Error('executeNode: graph has a cycle in the execution closure')
  }

  const nodesById = new Map<string, GraphNode>()
  for (const id of closureIds) nodesById.set(id, nodes[id]!)

  return { sorted, nodesById, edges: allEdges }
}

// Forward-BFS: the start node plus every node it feeds (directly or transitively).
function downstreamOf(nodeId: string, edges: readonly GraphEdge[]): Set<string> {
  const visited = new Set<string>([nodeId])
  const queue = [nodeId]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const edge of edges) {
      if (edge.source.nodeId === current && !visited.has(edge.target.nodeId)) {
        visited.add(edge.target.nodeId)
        queue.push(edge.target.nodeId)
      }
    }
  }
  return visited
}

// Reports whether a producer port already holds a usable cached output, i.e. the
// walk can hydrate it as a boundary instead of recomputing the producer.
export type FreshOutputProbe = (nodeId: string, port: string) => boolean

// Expand `closure` upward to also include any upstream ancestor whose feeding
// output is NOT already cached ("cold"). Without this, a partial (downstream)
// run of a target whose upstream has never executed — e.g. an AI/CLI/import that
// builds the whole graph in one batch with no per-node exec — silently resolves
// the target's inputs to empty and produces a blank result. Fresh ancestors stay
// a cached boundary (NOT re-run), so the incremental param-edit hot path is
// preserved; only genuinely uncomputed ancestors get pulled in to compute.
function addColdUpstream(
  closure: Set<string>,
  nodes: Record<string, GraphNode>,
  edges: readonly GraphEdge[],
  isFresh: FreshOutputProbe,
): void {
  const queue = [...closure]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const edge of edges) {
      if (edge.target.nodeId !== current) continue
      const srcId = edge.source.nodeId
      if (closure.has(srcId) || !nodes[srcId]) continue
      // Fresh cached output → leave as a hydrated boundary; cold → must compute.
      if (isFresh(srcId, edge.source.port)) continue
      closure.add(srcId)
      queue.push(srcId)
    }
  }
}

// Select and order the nodes to execute: with a target node, its DOWNSTREAM closure (the node
// plus everything it feeds) UNION any cold (uncached) upstream ancestors needed to actually
// compute its inputs; fresh upstream is hydrated from the output cache by the walk. Without a
// target, all nodes (pipeline mode). This keeps the incremental param-edit path fast (fresh
// upstream is never re-run) while fixing blank previews when upstream was never executed
// (cold cache). Throws on an unknown target or a cyclic closure.
export function buildExecutionClosure(
  nodes: Record<string, GraphNode>,
  edges: Record<string, GraphEdge>,
  targetNodeId: string | undefined,
  isFresh?: FreshOutputProbe,
): ExecutionClosure {
  const allEdges = Object.values(edges)
  let closureIds: string[]

  if (targetNodeId !== undefined) {
    if (!nodes[targetNodeId]) throw new Error(`executeNode: target node not found: ${targetNodeId}`)
    const closure = downstreamOf(targetNodeId, allEdges)
    // Pull in cold upstream so the target's inputs are computed, not silently empty.
    if (isFresh) addColdUpstream(closure, nodes, allEdges, isFresh)
    // Only nodes that still exist (an edge may dangle mid-edit).
    closureIds = [...closure].filter((id) => nodes[id])
  } else {
    closureIds = Object.keys(nodes)
  }

  const sorted = topologicalSort(closureIds, allEdges)
  if (sorted.length !== closureIds.length) {
    throw new Error('executeNode: graph has a cycle in the execution closure')
  }

  const nodesById = new Map<string, GraphNode>()
  for (const id of closureIds) nodesById.set(id, nodes[id]!)

  return { sorted, nodesById, edges: allEdges }
}
