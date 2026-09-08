// Local graph persist + param-write coalescer. Module-level seq / queue /
// in-flight maps are shared (never duplicated) so an older async persist cannot
// commit after a newer delete.

import { getEditorTransport } from '../transport/index.js'
import {
  logPersistDone,
  logPersistFlush,
  logPersistSchedule,
  setPersistTraceReason,
} from '../utils/refreshTrace.js'
import { syncTrace } from '../utils/syncTrace.js'
import type { Pipeline } from '../types.js'
import type { PipelineGet } from './pipelineStore.types.js'

// Local graph writes are serialized so an older async persist cannot commit
// after a newer delete and recreate nodes from its stale desired snapshot.
let _localMutationSeq = 0
// Snapshot loads establish a read-only baseline. This is intentionally tracked
// outside Zustand so each iframe can tell whether *it* edited that snapshot;
// split-pane navigation clients otherwise risk persisting stale canvas data.
let _pipelineBaselineMutationSeq = 0
let _persistQueue: Promise<unknown> = Promise.resolve()

// Debounced best-effort persist for high-frequency layout/UI changes (node
// drag, annotation/frame move, preview toggle). Coalesces a burst into a single
// op-persist; the underlying _persistQueue + seq guard still drop any stale
// snapshot, so this only trims redundant in-flight requests. An explicit
// persistSession() cancels the pending timer and flushes immediately.
const PERSIST_DEBOUNCE_MS = 500
let _persistTimer: ReturnType<typeof setTimeout> | null = null

// Local persist batches: correlate graph:applied self-echo with applyBatch metadata
// so layout-only / zero-invalidation writes skip the output fan-out storm.
const _persistBatchMeta = new Map<string, { layoutOnly: boolean; invalidatedNodeCount: number }>()
const PERSIST_BATCH_META_LIMIT = 64

function rememberPersistBatchMeta(
  batchId: string,
  meta: { layoutOnly?: boolean; invalidatedNodeCount?: number },
): void {
  _persistBatchMeta.set(batchId, {
    layoutOnly: !!meta.layoutOnly,
    invalidatedNodeCount: meta.invalidatedNodeCount ?? 0,
  })
  if (_persistBatchMeta.size > PERSIST_BATCH_META_LIMIT) {
    const oldest = _persistBatchMeta.keys().next().value
    if (oldest !== undefined) _persistBatchMeta.delete(oldest)
  }
}

// Local editor persists: graph:applied (WS) can land before the POST /batch
// response that carries layoutOnly / invalidatedNodeCount — await the in-flight
// persist so the skip path has metadata before deciding to fan-out.
const _localPersistInFlight = new Map<string, Promise<unknown>>()

let _onSyncedHash: ((hash: string) => void) | null = null
let _persistGet: PipelineGet | null = null

/** Wire persist → live-sync hash adoption without importing the live-sync module. */
export function bindPersistSyncedHash(cb: (hash: string) => void): void {
  _onSyncedHash = cb
}

/** Bind the store getter so persist retries/logs never import usePipelineStore. */
export function bindPersistStore(get: PipelineGet): void {
  _persistGet = get
}

export function markPipelineMutation(): void {
  _localMutationSeq += 1
}

export function hasLocalPipelineMutations(): boolean {
  return _localMutationSeq !== _pipelineBaselineMutationSeq
}

export function markPipelineBaseline(): void {
  _pipelineBaselineMutationSeq = _localMutationSeq
}

export function getLocalMutationSeq(): number {
  return _localMutationSeq
}

export function peekPersistBatchMeta(
  batchId: string,
): { layoutOnly: boolean; invalidatedNodeCount: number } | undefined {
  return _persistBatchMeta.get(batchId)
}

export function awaitLocalPersistInFlight(batchId: string): Promise<unknown> | undefined {
  return _localPersistInFlight.get(batchId)
}

export function forgetPersistBatchMeta(batchId: string): void {
  _persistBatchMeta.delete(batchId)
}

/**
 * `crypto.randomUUID()` exists only in a SECURE CONTEXT (https, or http on
 * localhost). The dev workbench is routinely opened over plain http on a LAN
 * address (`http://<host>:9555`), where it is simply undefined — and this id is
 * minted on the FIRST line of every persist, so the TypeError aborted the whole
 * save+execute chain before a single request went out: dropped batteries showed
 * up on the canvas, never reached the kernel, and vanished on refresh. Only the
 * uuid API is gated; `getRandomValues` works in insecure contexts, so the
 * fallback is still a proper random v4.
 */
function randomBatchId(): string {
  const c: Crypto | undefined = globalThis.crypto
  if (typeof c?.randomUUID === 'function') return c.randomUUID()
  if (typeof c?.getRandomValues === 'function') {
    const b = c.getRandomValues(new Uint8Array(16))
    b[6] = (b[6]! & 0x0f) | 0x40
    b[8] = (b[8]! & 0x3f) | 0x80
    const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  return `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// A persist that fails once used to be lost silently: no retry, no visible
// error. The canvas keeps showing the edit while the kernel never received it,
// so every later execute runs against a graph that does not contain those nodes
// (the "面板有内容、端口却 no result" report — the node existed only in the
// browser). The dev backend restarts on every kernel source edit
// (`tsx --watch`), so a transient failure here is routine, not exotic. Retry a
// few times with backoff, and if it still fails, say so loudly in the log.
const PERSIST_MAX_ATTEMPTS = 3
const PERSIST_RETRY_BACKOFF_MS = [200, 700]

async function persistWithRetry(
  transport: ReturnType<typeof getEditorTransport>,
  snapshot: Pipeline,
  seq: number,
  actor: string,
  clientBatchId: string,
): Promise<Awaited<ReturnType<typeof transport.api.updatePipeline>> | null> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await transport.api.updatePipeline(snapshot, actor, clientBatchId)
    } catch (error) {
      // A newer snapshot is already queued — it carries this edit too, so
      // retrying a stale one would only overwrite fresher state.
      if (seq !== _localMutationSeq) return null
      if (attempt >= PERSIST_MAX_ATTEMPTS) {
        console.error('[persist] pipeline save failed — the canvas is now ahead of the kernel:', error)
        _persistGet?.().addLog(`保存失败：画布改动未写入内核（${String(error)}）。请重试一次编辑或刷新页面。`)
        throw error
      }
      syncTrace('persist:retry', { attempt, actor, error: String(error) })
      await new Promise((resolve) => setTimeout(resolve, PERSIST_RETRY_BACKOFF_MS[attempt - 1] ?? 700))
    }
  }
}

/**
 * Fire a pending debounced persist right now. Wired to page-hide below: a
 * refresh (or tab close) within the debounce window used to discard the edit
 * outright, since nothing flushed on unload. `visibilitychange → hidden` still
 * runs with the document alive, so the request actually goes out.
 */
export function flushPendingPersist(reason: string): void {
  if (_persistTimer === null) return
  clearTimeout(_persistTimer)
  _persistTimer = null
  syncTrace('persist:flush-before-unload', { reason })
  void _persistGet?.().persistSession()
}

export function enqueuePipelinePersist(snapshot: Pipeline, seq: number, actor = 'editor', batchId?: string) {
  const clientBatchId = batchId ?? randomBatchId()
  const run = async () => {
    if (seq !== _localMutationSeq) return null
    let transport: ReturnType<typeof getEditorTransport>
    try {
      transport = getEditorTransport()
    } catch (error) {
      // Swallowing this used to make the editor look healthy while every save
      // was dropped on the floor: the canvas keeps the edit, the kernel never
      // hears about it, and a refresh reveals an empty graph. It happens for
      // real whenever the transport singleton is torn down under a live
      // document (a dev HMR module swap, a left-pane unmount racing the host).
      console.error('[persist] no editor transport — this edit was NOT saved:', error)
      _persistGet?.().addLog('保存失败：编辑器与内核的连接已失效，本次改动未写入。请刷新页面后重试。')
      return null
    }
    const t0 = performance.now()
    const res = await persistWithRetry(transport, snapshot, seq, actor, clientBatchId)
    if (res === null) return null
    // A rejected batch is a silent data loss too: HTTP succeeded, the kernel
    // refused the ops (a self-inconsistent diff, a stale expectedPrevHash), and
    // the canvas happily keeps showing nodes that were never committed.
    if (res.status === 'rejected') {
      console.error('[persist] kernel rejected the batch — this edit was NOT saved:', res.reason)
      _persistGet?.().addLog(`保存被内核拒绝，本次改动未写入：${res.reason ?? '未知原因'}`)
    }
    const hashUpdated = !!(res?.status === 'ok' && res.newHash)
    // The canvas already reflects this local edit (RF setters / store writes),
    // so adopt the resulting hash as our sync baseline. Otherwise the live-sync
    // reconciler would see the post-persist hash drift and force a redundant
    // full reload that can disrupt an in-progress local edit (e.g. mid-drag).
    if (hashUpdated) _onSyncedHash?.(res.newHash!)
    if (res?.status === 'ok' && res.batchId) {
      rememberPersistBatchMeta(res.batchId, {
        layoutOnly: res.layoutOnly,
        invalidatedNodeCount: res.invalidatedNodeCount,
      })
    }
    logPersistDone({
      status: res?.status ?? 'unknown',
      newHash: res?.newHash,
      layoutOnly: res.layoutOnly,
      lastSyncedHashUpdated: hashUpdated,
      durationMs: performance.now() - t0,
    })
    return res
  }
  const next = _persistQueue.then(run, run)
  _persistQueue = next.catch(() => undefined)
  _localPersistInFlight.set(clientBatchId, next)
  void next.finally(() => {
    _localPersistInFlight.delete(clientBatchId)
  })
  return next
}

// Live-drag param write coalescer. The hot path (slider drag / inspector scrub)
// must NOT serialize a whole-graph persist+diff per tick — that is the measured
// avalanche (persist leg 1.3s→3.3s as the queue backs up). Instead each tick
// submits ONE targeted `updateNode` ephemeral op (no getPipeline/listGroups/
// whole-graph diff, no history audit) via api.applyParamOp. To stop a backlog
// from forming we keep at most ONE in-flight write per node and remember only
// the LATEST pending params; while a write is in flight, newer ticks just
// overwrite the pending value, and the trailing run flushes that latest value.
// Stale intermediate values are dropped — the kernel only ever computes the
// newest param the user actually dragged to, so the round-trip can't grow.
interface PendingParamWrite {
  inFlight: boolean
  pending: { params: Record<string, unknown>; batchId?: string } | null
}
const _paramWrites = new Map<string, PendingParamWrite>()

export function enqueueParamWrite(
  nodeId: string,
  params: Record<string, unknown>,
  batchId?: string,
): Promise<void> {
  let entry = _paramWrites.get(nodeId)
  if (!entry) {
    entry = { inFlight: false, pending: null }
    _paramWrites.set(nodeId, entry)
  }
  // Always record the latest desired params; an in-flight write picks them up
  // when it drains, so a burst collapses to one trailing write of the newest value.
  entry.pending = { params, batchId }
  if (entry.inFlight) return Promise.resolve()

  const drain = async (): Promise<void> => {
    const e = _paramWrites.get(nodeId)
    if (!e || !e.pending) {
      if (e) e.inFlight = false
      return
    }
    e.inFlight = true
    const { params: p, batchId: b } = e.pending
    e.pending = null
    try {
      await getEditorTransport().api.applyParamOp(nodeId, p, 'editor', b)
    } catch (err) {
      console.warn('[pipelineStore] param write failed:', err)
    }
    // A newer tick may have arrived while this write was in flight — flush it.
    e.inFlight = false
    if (e.pending) await drain()
  }
  return drain()
}

export function createPersistSession(get: PipelineGet): () => Promise<void> {
  return async () => {
    if (_persistTimer) {
      clearTimeout(_persistTimer)
      _persistTimer = null
    }
    logPersistFlush()
    const { currentPipeline } = get()
    if (!currentPipeline) return
    const seq = _localMutationSeq
    try {
      const res = await enqueuePipelinePersist(currentPipeline, seq)
      if (res?.status === 'rejected') {
        if (res.diagnostics && res.diagnostics.length > 0) {
          // Plain-text dump so the diagnostics are copy-pasteable (Chrome collapses
          // the object form). One line per diagnostic: #opIndex [severity] message.
          const lines = res.diagnostics
            .map((d) => `  #${(d as { opIndex?: number }).opIndex ?? '?'} [${(d as { severity?: string }).severity ?? '?'}] ${(d as { message?: string }).message ?? JSON.stringify(d)}`)
            .join('\n')
          console.warn(`[Session] persist rejected: ${res.reason} (${res.diagnostics.length} diagnostics)\n${lines}`)
        } else {
          console.warn('[Session] persist rejected:', res.reason)
        }
      }
    } catch (error) {
      console.error('[Session] persist failed:', error)
    }
  }
}

export function createSchedulePersistSession(get: PipelineGet): (reason?: string) => void {
  return (reason?: string) => {
    if (reason) {
      setPersistTraceReason(reason)
      logPersistSchedule(reason)
    }
    if (_persistTimer) clearTimeout(_persistTimer)
    _persistTimer = setTimeout(() => {
      _persistTimer = null
      void get().persistSession()
    }, PERSIST_DEBOUNCE_MS)
  }
}
