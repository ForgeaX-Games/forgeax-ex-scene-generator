// applyBatch: the single atomic mutation entry-point.
//
// Every editor operation — UI drag, AI tool call, CLI command — translates
// into one or more Op records and submits them as a single batch. All-or-
// nothing semantics: validation runs over a copy of the live graph, and
// only on full success does the kernel swap graph.json + append a single
// history.jsonl entry.

import { randomUUID } from 'node:crypto'

import type { GraphFileV1 } from '../layer1/storage/types.js'
import type { GraphEdge } from '../layer1/types/graph.js'
import { getDownstreamNodeIds } from '../layer1/index.js'
import { gcOrphanGroups } from './group-reachability.js'
import { busFor } from './event-bus.js'
import { markGraphSelfWrite } from './graph-external-sync.js'
import { layoutIncrementalNewNodes } from './layout-incremental.js'
import type { Runtime } from './runtime.js'
import type { ApplyBatchOptions, ApplyBatchResult, Op } from './apply-batch-types.js'
import { batchIsLayoutOnly, collectCachedNodeIds, collectInvalidationSeeds } from './apply-batch-classify.js'
import { applyOps, emptyGraph } from './apply-batch-ops.js'

export { GROUP_OP_ID } from './group-constants.js'
export type {
  ExposedPortPatch,
  ExposedPortContract,
  Op,
  ApplyBatchOptions,
  Diagnostic,
  ApplyBatchResult,
} from './apply-batch-types.js'
export { batchIsLayoutOnly, summarizeBatchOps, collectCachedNodeIds } from './apply-batch-classify.js'
export { normalizeTextPanelParams } from './apply-batch-ops.js'

function cloneGraph(graph: GraphFileV1): GraphFileV1 {
  if (typeof structuredClone === 'function') return structuredClone(graph)
  return JSON.parse(JSON.stringify(graph)) as GraphFileV1
}

/**
 * Apply a batch of ops atomically to a pipeline. Runs every op against an
 * in-memory copy first; only on full success does the kernel write
 * graph.json and append the history entry.
 */
export async function applyBatch(
  runtime: Runtime,
  ops: readonly Op[],
  opts: ApplyBatchOptions = {},
): Promise<ApplyBatchResult> {
  const ts = opts.ts ?? new Date().toISOString()
  const batchId = opts.batchId ?? randomUUID()
  const actor = opts.actor ?? 'unknown'

  // Load existing graph or bootstrap.
  let current: GraphFileV1
  let prevHash: string
  if (runtime.graph.exists()) {
    const loaded = runtime.graph.load()
    if (!loaded) {
      return { status: 'rejected', reason: 'graph.json exists but failed to load' }
    }
    current = loaded
    prevHash = loaded.hash
  } else {
    const seed = emptyGraph(runtime.config.pipelineId, ts)
    current = { ...(seed as GraphFileV1), hash: 'EMPTY' }
    prevHash = 'EMPTY'
  }

  if (opts.expectedPrevHash !== undefined && opts.expectedPrevHash !== prevHash) {
    return {
      status: 'rejected',
      reason: `concurrent-write: expected prevHash=${opts.expectedPrevHash}, current=${prevHash}`,
    }
  }

  // Deep-clone so failed ops do not corrupt the live in-memory graph.
  const next = cloneGraph(current)
  next.updatedAt = ts

  const apply = applyOps(next, ops, runtime.registry)
  if (!apply.ok) {
    return {
      status: 'rejected',
      reason: 'op validation failed',
      diagnostics: apply.diagnostics,
    }
  }

  if (opts.autoLayoutNew !== false) {
    layoutIncrementalNewNodes(current, next, ops, runtime.registry)
  }

  if (opts.dryRun) {
    // No write. Caller gets a hypothetical newHash for preview.
    return {
      status: 'ok',
      diagnostics: [],
      batchId,
    }
  }

  // Sweep sub-groups no longer reachable from any top-level shadow node
  // (e.g. an ungroup/deleteGroup stranded a nested child). Shared sub-groups
  // referenced elsewhere stay alive.
  gcOrphanGroups(next)

  // Persist: GraphStore.save handles canonical-hash + atomic rename.
  let written: GraphFileV1
  try {
    written = runtime.graph.save(
      { ...next, hash: undefined as unknown as string },
      {
        expectedPrevHash: prevHash === 'EMPTY' ? undefined : prevHash,
        compact: opts.ephemeral === true,
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.startsWith('concurrent-write:')) {
      return { status: 'rejected', reason: message }
    }
    throw err
  }
  markGraphSelfWrite(runtime, written.hash)

  // Ephemeral batches (live drag ticks) persist + announce like a normal batch
  // but skip the audit line — the settled value is recorded by a later
  // non-ephemeral commit, so history.jsonl logs the final state, not every tick.
  if (!opts.ephemeral) {
    runtime.history.append({
      schemaVersion: 1,
      ts,
      actor,
      batchId,
      prevHash,
      newHash: written.hash,
      ops: ops as ReadonlyArray<Record<string, unknown>>,
      ...(opts.label !== undefined ? { label: opts.label } : {}),
    })
  }

  // Invalidate the output cache for every node whose input topology this batch
  // changed — and everything downstream of it. Without this, deleting an input
  // edge (or a node/group) leaves the persisted outputs/ cache untouched, so the
  // next execute re-hydrates stale values: most visibly for manualTrigger ops
  // (the executor skips re-running them and reads their cached output straight
  // back), which is why "删除输入边后输出没变". Seeds come from the PRE-batch graph
  // (disconnect targets are already gone from `next`); the BFS walks `next.edges`.
  const seeds = collectInvalidationSeeds(current, ops)
  // presentation-only seeds are already filtered inside collectInvalidationSeeds
  let invalidatedNodeCount = 0
  if (seeds.size > 0) {
    const nextEdges: GraphEdge[] = Object.values(next.edges)
    const allNodeIds = Object.keys(next.nodes)
    const toInvalidate = new Set<string>()
    for (const seed of seeds) {
      toInvalidate.add(seed)
      for (const id of getDownstreamNodeIds(seed, allNodeIds, nextEdges)) {
        toInvalidate.add(id)
      }
    }
    invalidatedNodeCount = toInvalidate.size
    for (const id of toInvalidate) runtime.outputs.invalidate(id)
  }

  // Sweep any output dirs left behind by deleted inner nodes / replaced ids.
  runtime.outputs.pruneOrphans(collectCachedNodeIds(next))
  runtime.outputs.pruneByRetention({ protectedNodeIds: collectCachedNodeIds(next) })

  const layoutOnly = batchIsLayoutOnly(ops, current)

  // Announce the mutation so consumers on the 'graph' channel learn about it —
  // except for layout-only batches (reposition / viewport / frames), which are
  // not data changes and must not drive a re-pull / preview rebuild.
  if (!layoutOnly) {
    busFor(runtime).emit({
      kind: 'graph:applied',
      pipelineId: runtime.config.pipelineId,
      batchId,
      newHash: written.hash,
    })
  }

  return {
    status: 'ok',
    newHash: written.hash,
    batchId,
    layoutOnly,
    invalidatedNodeCount,
  }
}
