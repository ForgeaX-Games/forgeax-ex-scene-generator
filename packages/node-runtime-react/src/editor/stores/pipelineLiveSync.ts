// Live-sync: graph:applied / hash-poll reconciler, local-param-edit self-echo
// suppression, and viewport-deferred refresh flush. `_lastSyncedHash` and
// `_localParamEditBatchIds` live here (shared, never duplicated).

import type { Pipeline } from '../types.js'
import { getEditorTransport } from '../transport/index.js'
import { bridgeBatchToHistory } from './pipelineHistoryBridge.js'
import { syncTrace } from '../utils/syncTrace.js'
import {
  deferGraphAppliedBatch,
  flushDeferredGraphAppliedBatches,
  isViewportMoving,
  registerGraphAppliedHandler,
  setViewportMoving,
  takeDeferredRefreshReason,
} from '../utils/viewportRefreshDefer.js'
import {
  awaitLocalPersistInFlight,
  forgetPersistBatchMeta,
  peekPersistBatchMeta,
  flushPendingPersist,
} from './pipelinePersist.js'
import {
  cancelLocalParamFanOutTimer,
  resetMountRefreshInFlight,
} from './pipelineOutputFanout.js'
import type { PipelineGet } from './pipelineStore.types.js'
import type { RefreshReason } from '../utils/refreshTrace.js'
import { LOCAL_PARAM_EDIT_BATCH_PREFIX } from './localParamEditBatch.js'

export { LOCAL_PARAM_EDIT_BATCH_PREFIX, isLocalParamEditBatch } from './localParamEditBatch.js'

// Live-sync reconciler: the canvas updates only when a `graph:applied` WS frame
// arrives, so a single missed frame (WS reconnect after a `tsx --watch` backend
// restart, the project-activate rebind window, or a dropped frame) leaves it
// stale with no recovery — while the polling image-preview surface stays current
// (exactly the "preview updates, canvas does not" symptom). The reconciler polls
// the cheap pipeline hash on an interval and refetches when it drifts from the
// last hash we synced, giving the canvas the same self-healing the preview has.
// `_lastSyncedHash` is the content hash of the snapshot currently rendered.
let _lastSyncedHash: string | null = null
const LIVE_SYNC_RECONCILE_MS = 1500

export function getLastSyncedHash(): string | null {
  return _lastSyncedHash
}

export function setLastSyncedHash(hash: string | null): void {
  _lastSyncedHash = hash
}

function edgeTopologySignature(pipeline: Pipeline | null | undefined): string {
  if (!pipeline) return ''
  return [...pipeline.edges]
    .map((e) => `${e.source.nodeId}:${e.source.port}->${e.target.nodeId}:${e.target.port}`)
    .sort()
    .join('|')
}

// Self-echo reload suppression for local param edits (slider drag, inspector
// edits). A local `incrementalExecute` already wrote the new param into
// `currentPipeline` BEFORE persisting, so the `graph:applied` self-echo for that
// write would only re-pull the identical snapshot — a full `loadPipeline()`
// rebuild of every node on every drag tick (the slider→preview lag). We tag each
// param-edit persist with a client-generated batchId, recorded synchronously
// BEFORE the write (so there is no race with the echo, whether it arrives in the
// same tick via the in-process mock or a tick later via a real WS), and let the
// handler skip the redundant reload for those batchIds. The grid preview still
// updates because `exec:completed` refreshes the connected outputs. Bounded ring
// so the set never grows unboundedly across a long session.
const _localParamEditBatchIds = new Set<string>()
const LOCAL_PARAM_EDIT_BATCH_LIMIT = 64
export function rememberLocalParamEditBatch(batchId: string): void {
  _localParamEditBatchIds.add(batchId)
  if (_localParamEditBatchIds.size > LOCAL_PARAM_EDIT_BATCH_LIMIT) {
    const oldest = _localParamEditBatchIds.values().next().value
    if (oldest !== undefined) _localParamEditBatchIds.delete(oldest)
  }
}
export function nextLocalParamEditBatchId(): string {
  return `${LOCAL_PARAM_EDIT_BATCH_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function consumeLocalParamEditBatch(batchId: string): boolean {
  if (!_localParamEditBatchIds.has(batchId)) return false
  _localParamEditBatchIds.delete(batchId)
  return true
}

// While a slider/inspector param edit is actively churning, each tick's execute
// response is applied directly (see hydrateExecutionResult), so the trailing WS
// `exec:completed` -> refreshConnectedOutputs() per-port GET storm is pure
// redundant network churn competing with the drag. Mark a short window after
// each local-param exec; the exec:completed handler skips its re-pull inside it.
// A settle (no new tick within the window) lets the normal refresh resume.
let _localParamEditUntil = 0
export const LOCAL_PARAM_EDIT_QUIET_MS = 150
const _localParamEditListeners = new Set<() => void>()
export function subscribeLocalParamEdit(listener: () => void): () => void {
  _localParamEditListeners.add(listener)
  return () => _localParamEditListeners.delete(listener)
}
export function markLocalParamEditActive(): void {
  _localParamEditUntil = Date.now() + LOCAL_PARAM_EDIT_QUIET_MS
  cancelLocalParamFanOutTimer()
  for (const listener of _localParamEditListeners) listener()
}
export function isLocalParamEditActive(): boolean {
  return Date.now() < _localParamEditUntil
}

// graph:applied can arrive on multiple WS bindings in the same tick — handle once.
const _handledGraphBatchIds = new Set<string>()
const HANDLED_GRAPH_BATCH_LIMIT = 128

function markGraphBatchHandled(batchId: string): boolean {
  if (_handledGraphBatchIds.has(batchId)) return false
  _handledGraphBatchIds.add(batchId)
  if (_handledGraphBatchIds.size > HANDLED_GRAPH_BATCH_LIMIT) {
    const oldest = _handledGraphBatchIds.values().next().value
    if (oldest !== undefined) _handledGraphBatchIds.delete(oldest)
  }
  return true
}

let _liveSyncGet: PipelineGet | null = null

export function bindLiveSyncStore(get: PipelineGet): void {
  _liveSyncGet = get
}

export function createSubscribeLiveSync(get: PipelineGet): () => () => void {
  return () => {
    const { ws, api } = getEditorTransport()
    ws.connect()
    // Fresh sync session: forget any hash de-duped under a prior subscription.
    _lastSyncedHash = null
    resetMountRefreshInFlight()
    _handledGraphBatchIds.clear()

    // Refetch the snapshot and record its content hash so the reconciler poll
    // below knows the canvas is up to date. Shared by the WS push path and the
    // poll fallback so both converge on the same "last synced" marker.
    const reloadAndRecordHash = async (): Promise<void> => {
      await get().loadPipeline()
      try {
        _lastSyncedHash = await api.getPipelineHash()
      } catch {
        /* transient — the next poll will retry */
      }
    }

    // Graph mutations (any actor) → refetch the snapshot, then refresh probe
    // values for the new wiring. Capture the PRE-batch pipeline FIRST (before
    // loadPipeline overwrites it) so a bridged history entry can undo back to
    // the state before this batch, then bridge the committed batch into the
    // visible history panel (non-local actors only).
    const handleGraphApplied = async (batchId: string | undefined): Promise<void> => {
      if (batchId && !markGraphBatchHandled(batchId)) return

      let meta = batchId ? peekPersistBatchMeta(batchId) : undefined
      if (batchId && meta === undefined) {
        const inFlight = awaitLocalPersistInFlight(batchId)
        if (inFlight) {
          await inFlight.catch(() => undefined)
          meta = peekPersistBatchMeta(batchId)
        }
      }
      if (batchId) forgetPersistBatchMeta(batchId)

      // Pure layout persist (reposition / frames) — kernel emits no bus event,
      // but guard anyway when meta says layout-only.
      if (meta?.layoutOnly) return

      // Local param-edit self-echo suppression. We tagged our own param-edit
      // persist with this batchId synchronously before writing, and already hold
      // the resulting snapshot locally, so a full loadPipeline() rebuild is pure
      // churn — and is the slider→preview lag. Skip the reload AND the duplicate
      // output-refresh here; the trailing `exec:completed` handler refreshes the
      // connected outputs once the new values are computed, which is what drives
      // the live grid preview.
      if (batchId && consumeLocalParamEditBatch(batchId)) {
        return
      }

      // Local persist with zero output-cache invalidation (e.g. updateGroup
      // metadata / group position) — canvas already holds the desired state;
      // skip loadPipeline + fan-out; outputs on disk are unchanged.
      if (meta && meta.invalidatedNodeCount === 0) {
        try {
          _lastSyncedHash = await api.getPipelineHash()
        } catch {
          /* transient */
        }
        return
      }

      const preSnapshot = get().currentPipeline
      await reloadAndRecordHash()
      await get().refreshConnectedOutputs('graph:applied')
      if (batchId) await bridgeBatchToHistory(batchId, preSnapshot)
    }

    registerGraphAppliedHandler((batchId) => {
      void handleGraphApplied(batchId)
    })

    const unsubGraph = ws.on('graph:applied', ({ batchId }) => {
      if (isViewportMoving()) {
        deferGraphAppliedBatch(batchId)
        return
      }
      void handleGraphApplied(batchId)
    })

    // Reconciler safety net: poll the lightweight pipeline hash and refetch when it
    // drifts from what we last synced. Catches any `graph:applied` frame the WS
    // missed (reconnect after a backend restart, the project-activate rebind
    // window, a dropped frame), so an AI/CLI graph mutation always reaches the
    // canvas — matching the polling image-preview surface's resilience.
    const reconcileTimer = setInterval(() => {
      void (async () => {
        if (isViewportMoving()) return
        let hash: string | null
        try {
          hash = await api.getPipelineHash()
        } catch {
          return // backend momentarily unreachable (e.g. mid-restart) — retry next tick
        }
        if (hash === null) return
        if (_lastSyncedHash === null) {
          // No baseline yet (initial mount before the first sync): adopt the
          // current hash without forcing a reload the mount already did.
          _lastSyncedHash = hash
          return
        }
        if (hash === _lastSyncedHash) return
        _lastSyncedHash = hash
        const edgeSigBefore = edgeTopologySignature(get().currentPipeline)
        await get().loadPipeline()
        const edgeSigAfter = edgeTopologySignature(get().currentPipeline)
        // Layout-only drift (reposition / frames) changes hash but not wiring —
        // output cache stays valid, so skip the multi-MB fan-out.
        if (edgeSigBefore === edgeSigAfter) return
        await get().refreshConnectedOutputs('reconcile')
      })()
    }, LIVE_SYNC_RECONCILE_MS)

    // Per-port output values. The kernel announces 'node:output' (port + type
    // only, no value) as a node executes; we pull the value via the generic
    // ApiClient and cache it in nodeOutputs — the kernel-native replacement for
    // the legacy WS NODE_OUTPUT push that fed the wire data-probe, port tooltips
    // and preview nodes.
    const unsubNodeOutput = ws.on('node:output', ({ nodeId, portId }) => {
      if (isViewportMoving()) return
      void api
        .getNodeOutput(nodeId, portId)
        .then((value) => {
          if (value !== undefined) get().setNodeOutput(nodeId, portId, value)
        })
        .catch(() => {
          /* port has no value yet / transient — ignore */
        })
    })

    // After a run completes, refresh every connected source port so probes are
    // correct even if a 'node:output' event was missed (and to match the legacy
    // "updates after execution" behaviour). Bounded by the edge count.
    const unsubExecCompleted = ws.on('exec:completed', () => {
      // During an active slider/inspector param drag, incrementalExecute already
      // applied this tick's outputs directly from the execute response, so the
      // per-port getNodeOutput re-pull here is redundant churn competing with the
      // drag. Skip it inside the quiet window; the drag-stop settle (which falls
      // outside the window) runs the full refresh once.
      if (isLocalParamEditActive()) {
        syncTrace('probe:exec-completed-skipped', { reason: 'localParamEditActive' })
        return
      }
      syncTrace('probe:exec-completed-refresh', {})
      void get().refreshConnectedOutputs('exec:completed')
      // If the user is INSIDE a group's internal view, the run just changed the
      // collapsed group's outputs, but refreshConnectedOutputs only covers the
      // root graph — inner nodes' wire data would stay stale. Re-probe the active
      // group's inner sub-graph (read-only; does not persist or emit events, so
      // it cannot re-trigger this handler) so the internal view's probes/ports/
      // AI previews reflect the latest run.
      const stack = get().groupViewStack
      const activeGroupId = stack.length > 0 ? stack[stack.length - 1] : null
      if (activeGroupId) void get().probeGroupInnerOutputs(activeGroupId)
    })

    // Battery hot-reload (dev): the backend re-scans batteries on a meta/index
    // edit and broadcasts `ops:changed`. Reload the catalog so the palette
    // reflects added/removed/renamed batteries without a manual refresh.
    const unsubOpsChanged = ws.on('ops:changed', () => {
      void get().loadBatteries()
    })

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') flushPendingPersist('visibilitychange')
    }
    const onPageHide = (): void => flushPendingPersist('pagehide')
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
      window.addEventListener('pagehide', onPageHide)
    }

    return () => {
      clearInterval(reconcileTimer)
      registerGraphAppliedHandler(() => {})
      unsubGraph()
      unsubNodeOutput()
      unsubExecCompleted()
      unsubOpsChanged()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
        window.removeEventListener('pagehide', onPageHide)
      }
    }
  }
}

/** Flush deferred graph:applied + output refresh after viewport pan/zoom ends. */
export function flushDeferredRefreshAfterViewport(): void {
  setViewportMoving(false)
  flushDeferredGraphAppliedBatches()
  const reason = takeDeferredRefreshReason()
  if (reason) void _liveSyncGet?.().refreshConnectedOutputs(reason as RefreshReason)
}
