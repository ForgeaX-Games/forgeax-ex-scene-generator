import {
  applyBatch,
  diffPipelineToOps,
  getPipeline,
  kernelGraphNodeList,
  listGroups,
  overlayNumberConstSliderPatches,
  stampNumberConstSliderParams,
  type ApplyBatchOptions,
  type ApplyBatchResult,
  type KernelGraphV1,
  type Runtime,
} from '@forgeax/node-runtime'

export interface IncrementalRuntimeImportResult extends ApplyBatchResult {
  changedOperationCount: number
}

/**
 * Project a last-run display graph into GraphStore so the canvas can paint.
 * Scene execution does not walk this graph.
 *
 * Stable @scene-id identities make unchanged nodes disappear from the diff.
 */
export async function importDisplayGraphIncrementally(
  runtime: Runtime,
  graph: KernelGraphV1,
  options: ApplyBatchOptions,
): Promise<IncrementalRuntimeImportResult> {
  stampDisplayGraphSliderParams(graph, getPipeline(runtime))
  const desired = {
    nodes: kernelGraphNodeList(graph.nodes),
    edges: Array.isArray(graph.edges) ? graph.edges : Object.values(graph.edges),
    groups: graph.groups
      ? Array.isArray(graph.groups) ? graph.groups : Object.values(graph.groups)
      : [],
  }
  const snapshot = getPipeline(runtime)
  const operations = diffPipelineToOps(desired, snapshot, listGroups(runtime))
  // Scene source owns display names for both calls and named literals.
  for (const node of desired.nodes) {
    if (node.name === undefined || node.name === snapshot?.nodes[node.id]?.name) continue
    const write = operations.find((op) =>
      (op.type === 'createNode' || op.type === 'updateNode') && op.nodeId === node.id,
    )
    if (write?.type === 'createNode' || write?.type === 'updateNode') write.name = node.name
    else operations.push({ type: 'updateNode', nodeId: node.id, name: node.name })
  }
  if (operations.length === 0) {
    return {
      status: 'ok',
      newHash: getPipeline(runtime)?.hash,
      invalidatedNodeCount: 0,
      changedOperationCount: 0,
    }
  }
  const result = await applyBatch(runtime, operations, options)
  return { ...result, changedOperationCount: operations.length }
}

export function stampDisplayGraphSliderParams(
  graph: KernelGraphV1,
  previous: KernelGraphV1 | { nodes?: KernelGraphV1['nodes'] } | null | undefined,
  ops?: ReadonlyArray<{ type: string; nodeId?: string; params?: Record<string, unknown> }>,
): KernelGraphV1 {
  const nodes = kernelGraphNodeList(graph.nodes)
  stampNumberConstSliderParams(nodes, previousSliderLookup(previous?.nodes))
  if (ops) overlayNumberConstSliderPatches(nodes, ops)
  return graph
}

function previousSliderLookup(
  nodes: KernelGraphV1['nodes'] | undefined,
): Record<string, { opId?: string; params?: Record<string, unknown> } | undefined> | undefined {
  if (!nodes) return undefined
  if (Array.isArray(nodes)) return Object.fromEntries(nodes.map((node) => [node.id, node]))
  return nodes as Record<string, { opId?: string; params?: Record<string, unknown> } | undefined>
}
