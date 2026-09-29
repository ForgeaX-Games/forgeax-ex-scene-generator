// Param-exec in-flight coalescing + post-execute hydration. Module-level
// in-flight flags are shared (never duplicated). Does not import usePipelineStore.

import type { ExecutionResult } from '@forgeax/node-runtime'
import { getEditorTransport } from '../transport/index.js'
import { collectHiddenOutputPorts, getDownstreamIds, listMissingVisibleOutputPorts } from './pipelineStore.helpers.js'
import { syncTrace, summarizeNodeOutputs } from '../utils/syncTrace.js'
import {
  enqueueParamWrite,
  enqueuePipelinePersist,
  getLocalMutationSeq,
} from './pipelinePersist.js'
import { fanOutConnectedOutputsBatch, scheduleLocalParamFanOut } from './pipelineOutputFanout.js'
import {
  LOCAL_PARAM_EDIT_QUIET_MS,
  markLocalParamEditActive,
  nextLocalParamEditBatchId,
  rememberLocalParamEditBatch,
} from './pipelineLiveSync.js'
import type { PipelineGet, PipelineSet, PipelineState } from './pipelineStore.types.js'

// Live param-edit (slider drag) execution driver: a "latest value wins" stream
// with no fixed-interval throttle. `_execInFlight` ensures at most one execute
// for a dragged param runs at a time; `_execThrottlePendingId` remembers the
// newest node to run the moment the in-flight one settles. The slider itself
// caps pushes to one per animation frame, so this stays continuous (tracks the
// finger) instead of being diluted into a few sparse ticks.
let _execInFlight = false
let _execThrottlePendingId: string | null = null
let _groupParamExecInFlight = false
let _groupParamExecPendingId: string | null = null
let _autoExecInFlight: Promise<void> | null = null

async function listStaleHiddenOutputPorts(
  get: PipelineGet,
  api: ReturnType<typeof getEditorTransport>['api'],
  pipeline: NonNullable<PipelineState['currentPipeline']>,
  batteries: PipelineState['batteries'],
): Promise<Array<{ nodeId: string; port: string }>> {
  if (typeof api.getNodeOutputsBatch !== 'function') return []
  const ports = collectHiddenOutputPorts(pipeline, batteries, get().dynamicOutputPorts)
  if (ports.length === 0) return []
  try {
    const res = await api.getNodeOutputsBatch(
      ports.map((p) => ({ nodeId: p.nodeId, portId: p.port })),
      { metaOnly: true },
    )
    if (!res) return []
    return res.filter((r) => r.meta?.valid !== true).map((r) => ({ nodeId: r.nodeId, port: r.portId }))
  } catch {
    return []
  }
}

// Run one local-param-edit execute, then immediately fire the latest pending one
// (if a newer drag value arrived while this was in flight). Defined at module
// scope so updateNodeParam can drive it without re-creating closures per call.
async function runParamExec(get: PipelineGet, nodeId: string): Promise<void> {
  _execInFlight = true
  try {
    await get().incrementalExecute(nodeId, false, { localParamEdit: true })
  } finally {
    _execInFlight = false
    if (_execThrottlePendingId !== null) {
      const next = _execThrottlePendingId
      _execThrottlePendingId = null
      void runParamExec(get, next)
    }
  }
}

/** Group-param counterpart to runParamExec: one full group diff/execute at a time. */
async function runGroupParamExec(get: PipelineGet, groupId: string): Promise<void> {
  _groupParamExecInFlight = true
  try {
    await get().incrementalExecute(groupId, false, { localPreviewEdit: true })
  } finally {
    _groupParamExecInFlight = false
    if (_groupParamExecPendingId !== null) {
      const next = _groupParamExecPendingId
      _groupParamExecPendingId = null
      void runGroupParamExec(get, next)
    }
  }
}

export function enqueueGroupParamExecute(get: PipelineGet, groupId: string): void {
  if (_groupParamExecInFlight) {
    _groupParamExecPendingId = groupId
  } else {
    void runGroupParamExec(get, groupId)
  }
}

export function enqueueParamExecute(get: PipelineGet, nodeId: string): void {
  if (!_execInFlight) {
    void runParamExec(get, nodeId)
  } else {
    _execThrottlePendingId = nodeId
  }
}

/** Apply inline execute-response outputs into the editor probe/preview cache. */
function isEmptyPortValue(value: unknown): boolean {
  if (value === null) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value as object).length === 0
  return false
}

export function applyExecutionResultOutputs(
  get: PipelineGet,
  result: Pick<ExecutionResult, 'outputs' | 'status'> | null | undefined,
): void {
  if (!result?.outputs) return
  syncTrace('hydrate:inline-outputs', {
    nodes: summarizeNodeOutputs(result.outputs as Record<string, Record<string, unknown>>),
  })
  const onError = result.status === 'error'
  const setOut = get().setNodeOutput
  for (const [outNodeId, ports] of Object.entries(result.outputs)) {
    for (const [portName, value] of Object.entries(ports)) {
      if (value === undefined) continue
      if (onError && isEmptyPortValue(value)) continue
      setOut(outNodeId, portName, value)
    }
  }
}

type ExecuteRequest = { startNodeId?: string; quietErrors?: boolean }

export function isMissingExecuteTarget(
  result: Pick<ExecutionResult, 'status' | 'error'> | null | undefined,
): boolean {
  if (result?.status !== 'error') return false
  return /not found/i.test(result.error?.message ?? '')
}

/**
 * After an import/replace persist, the requested node id may be gone.
 * Prefer that id when the kernel still has it; if exactly one new node
 * appeared, execute that. Scene Script drops keep the canvas id, so this
 * is a safety net for other rewrites — not a second identity system.
 */
export function pickExecuteTargetAfterRemap(
  requestedId: string,
  beforeIds: readonly string[],
  kernelIds: readonly string[],
): ExecuteRequest | undefined {
  if (kernelIds.includes(requestedId)) return { startNodeId: requestedId }
  const before = new Set(beforeIds)
  const added = kernelIds.filter((id) => !before.has(id))
  if (added.length === 1) return { startNodeId: added[0] }
  return undefined
}

/** Kernel execute — full pipeline or a node's downstream closure. */
export async function callPipelineExecute(request?: ExecuteRequest): Promise<ExecutionResult> {
  const { api } = getEditorTransport()
  if (request?.startNodeId) {
    return api.executePipeline({
      startNodeId: request.startNodeId,
      ...(request.quietErrors ? { quietErrors: true } : {}),
    })
  }
  return api.executePipeline(request?.quietErrors ? { quietErrors: true } : undefined)
}

/**
 * Single post-execute hydration path for every actor (human connect/param, Run,
 * agent, clear-cache). Inline small ports land immediately; sharded ports fan
 * out from the output cache. Param-drag defers the fan-out briefly because
 * exec:completed refresh is suppressed during the quiet window.
 */
export async function hydrateExecutionResult(
  get: PipelineGet,
  result: ExecutionResult | null | undefined,
  options: { deferCacheFanOut?: boolean } = {},
): Promise<void> {
  syncTrace('hydrate:start', {
    deferCacheFanOut: !!options.deferCacheFanOut,
    status: result?.status,
    inlineNodes: result?.outputs ? Object.keys(result.outputs).length : 0,
  })
  applyExecutionResultOutputs(get, result)
  const fanOut = (): Promise<void> => get().refreshConnectedOutputs('exec:completed')
  if (options.deferCacheFanOut) {
    scheduleLocalParamFanOut(() => {
      void (async () => {
        try {
          getEditorTransport()
          syncTrace('hydrate:deferred-fanout', {})
          await fanOut()
        } catch {
          /* editor torn down between drag tick and trailing refresh */
        }
      })()
    }, LOCAL_PARAM_EDIT_QUIET_MS + 20)
    return
  }
  syncTrace('hydrate:immediate-fanout', {})
  await fanOut()
}

export function createIncrementalExecute(get: PipelineGet): PipelineState['incrementalExecute'] {
  return async (nodeId, fullExec = false, options = {}) => {
    const { currentPipeline, addLog } = get()
    if (!currentPipeline) return undefined
    const localPreviewEdit = !!(options.localParamEdit || options.localPreviewEdit)
    syncTrace('exec:start', { nodeId, fullExec, localParamEdit: !!options.localParamEdit, localPreviewEdit, persist: options.persist !== false })
    const downstreamIds = getDownstreamIds(nodeId, currentPipeline.edges)
    const seq = getLocalMutationSeq()
    try {
      // Persist the latest graph first, then execute — unless the caller already
      // persisted (e.g. a drag-stop that ran schedulePersistSession), in which
      // case skip the redundant op-persist round-trip.
      if (options.persist !== false) {
        if (options.localParamEdit) {
          // HOT PATH (slider drag / inspector scrub). Do NOT run the whole-graph
          // persist+diff (getPipeline + listGroups + diffPipelineToOps + applyOps)
          // behind the serial _persistQueue — that is the measured avalanche
          // (persist leg 1.3s→3.3s). Instead submit ONE targeted ephemeral
          // `updateNode` op for just this node's params, coalesced so a burst
          // can't back up (latest value wins, stale drops). The kernel still
          // persists graph.json + invalidates caches, so the very next execute
          // computes with the new value (SSOT preserved); only the history audit
          // line is deferred to the settled commit below. Then debounce a normal
          // durable persist so the FINAL value lands in history.jsonl exactly once.
          const localBatchId = nextLocalParamEditBatchId()
          rememberLocalParamEditBatch(localBatchId)
          markLocalParamEditActive() // suppress the redundant WS re-pull this tick
          const editedNode = currentPipeline.nodes.find((n) => n.id === nodeId)
          if (editedNode) {
            await enqueueParamWrite(nodeId, { ...editedNode.params }, localBatchId)
          }
          // Commit the settled value durably (records the single history entry).
          // Debounced: only fires once the drag stops churning.
          get().schedulePersistSession('param-edit-settle')
        } else if (options.localPreviewEdit) {
          // Group internals cannot use the targeted updateNode param op: their
          // params live in the RawTemplateGroup. Persist one coalesced group
          // snapshot, but tag it like a local drag so graph self-echo and
          // renderer cache re-pulls do not compete with direct live output.
          const localBatchId = nextLocalParamEditBatchId()
          rememberLocalParamEditBatch(localBatchId)
          markLocalParamEditActive()
          await enqueuePipelinePersist(currentPipeline, seq, 'editor', localBatchId)
        } else {
          // A local param edit (slider drag / inspector) already wrote the new
          // value into currentPipeline above. Tag the persist with a client batchId
          // recorded synchronously NOW, so the matching `graph:applied` self-echo is
          // recognized as our own write and does NOT trigger a full loadPipeline()
          // rebuild — that per-tick rebuild is the slider→preview lag. Outputs still
          // refresh via the trailing `exec:completed`.
          await enqueuePipelinePersist(currentPipeline, seq, 'editor')
        }
      }
      // Execute + hydrate through the shared post-exec path (see hydrateExecutionResult).
      let result = fullExec
        ? await callPipelineExecute()
        : await callPipelineExecute({ startNodeId: nodeId })
      let executedId = nodeId
      if (!fullExec && isMissingExecuteTarget(result)) {
        const kernel = await getEditorTransport().api.getPipeline()
        const retry = pickExecuteTargetAfterRemap(
          nodeId,
          currentPipeline.nodes.map((n) => n.id),
          (kernel?.nodes ?? []).map((n) => n.id),
        )
        executedId = retry?.startNodeId ?? '(full)'
        addLog(
          retry?.startNodeId
            ? `Incremental exec: node ${nodeId} remapped to ${retry.startNodeId}`
            : `Incremental exec: node ${nodeId} remapped — running full pipeline`,
        )
        result = await callPipelineExecute(retry)
      }
      await hydrateExecutionResult(get, result, { deferCacheFanOut: localPreviewEdit })
      syncTrace('exec:done', {
        nodeId: executedId,
        status: result?.status,
        error: result?.error?.message,
        inlineOutputs: result?.outputs ? summarizeNodeOutputs(result.outputs as Record<string, Record<string, unknown>>) : '(none)',
      })
      addLog(
        fullExec
          ? `Full exec: pipeline (${currentPipeline.nodes.length} nodes)`
          : `Incremental exec: node ${executedId}, ${downstreamIds.length} downstream node(s)`,
      )
      return result
    } catch (error) {
      syncTrace('exec:error', { nodeId, error: String(error) })
      addLog(`Execution failed: ${error}`)
      return undefined
    }
  }
}

export function createExecutePipeline(get: PipelineGet, set: PipelineSet): (opts?: { quietErrors?: boolean }) => Promise<void> {
  return async (opts?: { quietErrors?: boolean }) => {
    const { addLog, setCompileInfo } = get()
    try {
      set({ pipelineStatus: 'running' })
      addLog('Executing pipeline…')
      setCompileInfo({ status: 'compiling', message: 'Compiling…' })
      const result: ExecutionResult = await callPipelineExecute(
        opts?.quietErrors ? { quietErrors: true } : undefined,
      )
      await hydrateExecutionResult(get, result)
      setCompileInfo({ status: 'success', message: 'Compiled successfully' })
      addLog('Pipeline execution complete')
      set({ pipelineStatus: result.status === 'error' ? 'error' : 'completed' })
    } catch (error) {
      console.error('Failed to execute pipeline:', error)
      addLog(`Execution failed: ${error}`)
      setCompileInfo({ status: 'error', message: String(error) })
      set({ pipelineStatus: 'error' })
    }
  }
}

export function createClearCacheAndExecutePipeline(get: PipelineGet, set: PipelineSet): () => Promise<void> {
  return async () => {
    const { addLog, pipelineStatus, setCompileInfo } = get()
    if (pipelineStatus === 'running') return
    syncTrace('rerun:clear-cache-and-exec', {})
    try {
      addLog('Clearing output cache…')
      await getEditorTransport().api.clearOutputCache()
      set({ nodeOutputs: {} })
      addLog('Output cache cleared — re-executing pipeline…')
      await get().executePipeline({ quietErrors: true })
    } catch (error) {
      console.error('Clear & re-execute failed:', error)
      addLog(`Clear & re-execute failed: ${error}`)
      setCompileInfo({ status: 'error', message: String(error) })
      set({ pipelineStatus: 'error' })
    }
  }
}

export function createAutoExecuteOnOpen(get: PipelineGet): () => Promise<void> {
  return async () => {
    if (_autoExecInFlight) return _autoExecInFlight
    _autoExecInFlight = (async () => {
      const { currentPipeline, batteries, addLog } = get()
      if (!currentPipeline || currentPipeline.nodes.length === 0) return
      const recomputeMissing = (): Array<{ nodeId: string; port: string }> =>
        listMissingVisibleOutputPorts(currentPipeline, batteries, get().dynamicOutputPorts, get().nodeOutputs)
      let missing = recomputeMissing()
      const { api } = getEditorTransport()
      const staleSinks = await listStaleHiddenOutputPorts(get, api, currentPipeline, batteries)
      if (missing.length === 0 && staleSinks.length === 0) return
      syncTrace('autoExecOnOpen:missing', {
        count: missing.length,
        staleSinks: staleSinks.length,
        ports: missing.slice(0, 8).map((p) => `${p.nodeId}/${p.port}`),
      })

      // Most "missing" hits here are a CLIENT-side cache gap, not a disk-cache
      // gap: `nodeOutputs` is wiped on every project switch, and
      // `dynamicOutputPorts` for group-inner nodes can still be growing while
      // this check runs (observed in [output-batch-trace]: metaOnly port scans
      // going from 205 -> 279 ports across the same open). So a port whose disk
      // cache is perfectly valid can show up as "missing" purely because the
      // refreshConnectedOutputs() pass that just resolved didn't cover it yet.
      // One more batched *fetch* (cheap: reads the output cache, never
      // recomputes anything) resolves that class before we conclude a real
      // *execute* is needed.
      const backfill = missing.length > 0
        ? await fanOutConnectedOutputsBatch(get, api, missing, 'autoexec-backfill')
        : null
      if (backfill) {
        missing = recomputeMissing()
        if (missing.length === 0 && staleSinks.length === 0) {
          syncTrace('autoExecOnOpen:backfilled', { fetched: backfill.fetched })
          return
        }
      }

      const hasRunnable = currentPipeline.nodes.some((n) => {
        if (n.batteryId === '__group__') return true
        const battery = batteries.find((b) => b.id === n.batteryId)
        return battery?.type !== 'ai'
      })
      if (!hasRunnable) return

      // Scope the real compute to just the nodes still missing a value, not
      // the whole graph. A node's own missing output already implies its
      // downstream is stale/missing too (nothing downstream can have a valid
      // cached value built from an input it never had), so pruning any root
      // already covered by another root's downstream closure keeps this to
      // the minimal set of independent re-run entry points.
      const missingNodeIds = Array.from(new Set([...missing, ...staleSinks].map((p) => p.nodeId)))
      const roots: string[] = []
      const covered = new Set<string>()
      for (const nodeId of missingNodeIds) {
        if (covered.has(nodeId)) continue
        roots.push(nodeId)
        for (const id of getDownstreamIds(nodeId, currentPipeline.edges)) covered.add(id)
      }
      if (roots.length === 0) return

      // Once the missing roots already touch most of the graph (true cold
      // start / a freshly cleared cache), N incremental walks end up
      // re-deriving almost everything anyway — a single full execute is
      // simpler and no more expensive.
      const fullGraphThreshold = Math.max(1, Math.ceil(currentPipeline.nodes.length * 0.6))
      if (roots.length > fullGraphThreshold) {
        addLog(`Missing ${missing.length} cached output(s) on open — auto-running full pipeline`)
        await get().executePipeline()
        return
      }

      addLog(
        `Missing ${missing.length} cached output(s) on open — auto-running ${roots.length} affected subgraph(s)`,
      )
      for (const nodeId of roots) {
        const result = await callPipelineExecute({ startNodeId: nodeId })
        applyExecutionResultOutputs(get, result)
        syncTrace('autoExecOnOpen:exec-root', { nodeId, status: result?.status })
      }
      // One shared fan-out at the end (instead of one per root) picks up any
      // remaining sharded/tooLarge ports the inline execute responses omit.
      await get().refreshConnectedOutputs('exec:completed')
    })().finally(() => {
      _autoExecInFlight = null
    })
    return _autoExecInFlight
  }
}

export function createStopPipeline(get: PipelineGet, set: PipelineSet): () => Promise<void> {
  return async () => {
    const { addLog } = get()
    try {
      await getEditorTransport().api.stopPipeline()
      addLog('Pipeline stopped')
      set({ pipelineStatus: 'stopped' })
    } catch (error) {
      console.error('Failed to stop pipeline:', error)
      addLog(`Stop failed: ${error}`)
    }
  }
}
