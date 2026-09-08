import {
  applyBatch,
  diffPipelineToOps,
  getPipeline,
  listGroups,
  type ApplyBatchOptions,
  type ApplyBatchResult,
  type KernelGraphV1,
  type Runtime,
} from '@forgeax/node-runtime'

export interface IncrementalRuntimeImportResult extends ApplyBatchResult {
  changedOperationCount: number
}

/**
 * Reconcile a compiled graph through the kernel's normal mutation API.
 *
 * Stable Scene Script identities make unchanged nodes disappear from the diff.
 * applyBatch then invalidates only changed nodes and their downstream closure,
 * so executeNode can reuse unaffected cached outputs.
 */
export async function importCompiledGraphIncrementally(
  runtime: Runtime,
  graph: KernelGraphV1,
  options: ApplyBatchOptions,
): Promise<IncrementalRuntimeImportResult> {
  const desired = {
    nodes: Array.isArray(graph.nodes) ? graph.nodes : Object.values(graph.nodes),
    edges: Array.isArray(graph.edges) ? graph.edges : Object.values(graph.edges),
    groups: graph.groups
      ? Array.isArray(graph.groups) ? graph.groups : Object.values(graph.groups)
      : [],
  }
  const operations = diffPipelineToOps(desired, getPipeline(runtime), listGroups(runtime))
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
