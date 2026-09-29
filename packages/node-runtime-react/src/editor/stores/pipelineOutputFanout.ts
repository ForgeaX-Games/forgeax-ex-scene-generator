// Output-cache fan-out: executedHash skip, tooLarge short-circuit, coalesced
// refreshConnectedOutputs, deferred large-port hydration, and the trailing
// local-param fan-out timer. Module-level caches are shared (never duplicated).

import { getEditorTransport } from '../transport/index.js'
import { hydrateBlobRefs } from '../../api/sceneEnvelope.js'
import {
  collectVisibleOutputPorts,
  resolveOutputPortType,
} from './pipelineStore.helpers.js'
import { isTooLargeOutputSummary, makeTooLargeOutputSummary } from '../utils/tooLargeOutputSummary.js'
import {
  estimateValueBytes,
  logRefreshEnd,
  logRefreshStart,
  refreshTraceEnabled,
  type RefreshReason,
  type RefreshPortStat,
} from '../utils/refreshTrace.js'
import { syncTrace } from '../utils/syncTrace.js'
import { deferRefreshUntilViewportEnd, isViewportMoving } from '../utils/viewportRefreshDefer.js'
import type { PipelineGet, PipelineSet } from './pipelineStore.types.js'

// refreshConnectedOutputs fan-out control. Mount + loadPipeline + live-sync +
// project-activate frequently request a refresh in the same tick; coalescing
// avoids stacking N identical GET storms, and the per-run concurrency cap keeps
// a large graph from opening hundreds of parallel requests at once.
let _outputsRefreshInFlight: Promise<void> | null = null
let _outputsRefreshAgain = false
/** StrictMode / coalesced mount calls share one fan-out per editor session. */
let _mountRefreshInFlight: Promise<void> | null = null
/** Sharded (multi-MB) ports skipped on mount — hydrated one-at-a-time when idle. */
let _deferredLargePortTimer: ReturnType<typeof setTimeout> | null = null
/** One trailing cache fan-out for the entire drag, never one timer per tick. */
let _localParamFanOutTimer: ReturnType<typeof setTimeout> | null = null
const _deferredLargePorts: Array<{ nodeId: string; port: string }> = []
// Set when a fan-out ran before the battery catalog was loaded (see
// fanOutConnectedOutputs); loadBatteries() re-runs the pass once it clears.
let _fanOutMissedCatalog = false

export function takeFanOutMissedCatalogIfReady(catalogSize: number): boolean {
  if (!_fanOutMissedCatalog || catalogSize === 0) return false
  _fanOutMissedCatalog = false
  return true
}
// Each worker fetches a node port's FULL output value. Scene outputs can be
// hundreds of MB (voxel-mass data trees), and the backend reassembles + JSON-
// serializes each one in memory for the HTTP response. At concurrency 8 that
// was several 400MB trees in flight simultaneously — a multi-GB heap spike that
// helped tip the backend into OOM. 3 keeps the refresh responsive while
// bounding the worst-case concurrent payload memory.
const OUTPUTS_REFRESH_CONCURRENCY = 3

/** executedHash per (nodeId, port) — skip full GET when cache entry unchanged. */
const _outputMetaByPort: Record<string, Record<string, string>> = {}

/**
 * executedHash per (nodeId, port) that the backend already told us is too
 * large to inline (tooLarge: true) — e.g. structural merge nodes (n_merge,
 * n_flatten) that carry a group's full pre-dedup fan-out. Without this, the
 * "changed?" check below always saw `cached === undefined` for these ports
 * (a tooLarge response never calls setNodeOutput) and re-classified them as
 * "changed" on *every* refresh pass forever, re-paying the ~100-300ms
 * portByteSize scan each time — 17 repeats of the same unchanged 2 ports cost
 * ~5s in one observed project-switch trace. Once we've seen tooLarge for a
 * given hash, treat that hash as settled (same as a normal cache hit) until
 * the node re-executes and the hash actually changes.
 */
const _knownTooLargeByPort: Record<string, Record<string, string>> = {}

/** Trailing output refresh after project switch while an agent was busy. */
let _projectSwitchOutputTimer: ReturnType<typeof setTimeout> | null = null

export function clearOutputMetaCache(): void {
  for (const k of Object.keys(_outputMetaByPort)) delete _outputMetaByPort[k]
  for (const k of Object.keys(_knownTooLargeByPort)) delete _knownTooLargeByPort[k]
}

export function clearOutputMetaForNodes(nodeIds: readonly string[]): void {
  for (const id of nodeIds) {
    delete _outputMetaByPort[id]
    delete _knownTooLargeByPort[id]
  }
}

export function cancelDeferredProjectSwitchOutputRefresh(): void {
  if (_projectSwitchOutputTimer) {
    clearTimeout(_projectSwitchOutputTimer)
    _projectSwitchOutputTimer = null
  }
}

/** When an agent holds an execute lock, defer output hydration so browse switches stay snappy. */
export function scheduleDeferredProjectSwitchOutputRefresh(run: () => void): void {
  cancelDeferredProjectSwitchOutputRefresh()
  const schedule =
    typeof requestIdleCallback === 'function'
      ? (fn: () => void) => requestIdleCallback(fn, { timeout: 12_000 })
      : (fn: () => void) => setTimeout(fn, 2000)
  _projectSwitchOutputTimer = setTimeout(() => {
    _projectSwitchOutputTimer = null
    schedule(run)
  }, 1500)
}

export function resetMountRefreshInFlight(): void {
  _mountRefreshInFlight = null
}

export function cancelLocalParamFanOutTimer(): void {
  if (_localParamFanOutTimer) {
    clearTimeout(_localParamFanOutTimer)
    _localParamFanOutTimer = null
  }
}

export function scheduleLocalParamFanOut(run: () => void, delayMs: number): void {
  if (_localParamFanOutTimer) clearTimeout(_localParamFanOutTimer)
  _localParamFanOutTimer = setTimeout(() => {
    _localParamFanOutTimer = null
    run()
  }, delayMs)
}

function applyTooLargeOutputSummary(
  get: PipelineGet,
  nodeId: string,
  portId: string,
  meta: {
    executedHash?: string
    valid?: boolean
    sharded?: boolean
    dataChunks?: number
    type?: string
  } | null,
  estimatedBytes?: number,
): void {
  const { currentPipeline, batteries, dynamicOutputPorts } = get()
  const portType =
    meta?.type ??
    resolveOutputPortType(currentPipeline, batteries, dynamicOutputPorts, nodeId, portId)
  const summary = makeTooLargeOutputSummary({
    nodeId,
    portId,
    portType,
    sharded: meta?.sharded,
    dataChunks: meta?.dataChunks,
    estimatedBytes,
  })
  get().setNodeOutput(nodeId, portId, summary)
  if (meta?.executedHash) {
    if (!_outputMetaByPort[nodeId]) _outputMetaByPort[nodeId] = {}
    _outputMetaByPort[nodeId][portId] = meta.executedHash
    if (!_knownTooLargeByPort[nodeId]) _knownTooLargeByPort[nodeId] = {}
    _knownTooLargeByPort[nodeId][portId] = meta.executedHash
  }
}

function fanOutScopeForReason(_reason: RefreshReason): 'edges' | 'all' {
  // Always hydrate visible output ports — edge-only scope left wire probes on
  // terminal sinks (scene_output) and unconnected batteries showing "no result"

  // after refresh until a manual Rerun.
  return 'all'
}

function scheduleDeferredLargePortHydration(
  get: PipelineGet,
  ports: ReadonlyArray<{ nodeId: string; port: string }>,
): void {
  if (ports.length === 0) return
  for (const p of ports) {
    const key = `${p.nodeId}\u0000${p.port}`
    if (_deferredLargePorts.some((d) => `${d.nodeId}\u0000${d.port}` === key)) continue
    _deferredLargePorts.push(p)
  }
  if (_deferredLargePortTimer) return
  const tick = (): void => {
    _deferredLargePortTimer = null
    if (isViewportMoving() || _deferredLargePorts.length === 0) {
      if (_deferredLargePorts.length > 0) {
        _deferredLargePortTimer = setTimeout(tick, 250)
      }
      return
    }
    const next = _deferredLargePorts.shift()!
    void (async () => {
      const t0 = performance.now()
      try {
        const { api } = getEditorTransport()
        let meta: { executedHash: string; valid: boolean } | null = null
        try {
          meta = await api.getNodeOutputMeta(next.nodeId, next.port)
        } catch {
          /* optional */
        }
        const value = await api.getNodeOutput(next.nodeId, next.port)
        if (value !== undefined) {
          get().setNodeOutput(next.nodeId, next.port, value)
          if (meta?.executedHash) {
            if (!_outputMetaByPort[next.nodeId]) _outputMetaByPort[next.nodeId] = {}
            _outputMetaByPort[next.nodeId][next.port] = meta.executedHash
          }
        } else if (meta?.valid) {
          applyTooLargeOutputSummary(get, next.nodeId, next.port, meta)
        }
        if (refreshTraceEnabled()) {
          const bytes = estimateValueBytes(value)
          if (bytes > 256 * 1024) {
            console.log(
              `[refresh-trace] mount-deferred ${next.nodeId}/${next.port} ` +
                `${(bytes / (1024 * 1024)).toFixed(2)}MB ${(performance.now() - t0).toFixed(0)}ms`,
            )
          }
        }
      } catch {
        /* cold / transient */
      }
      _deferredLargePortTimer = setTimeout(tick, _deferredLargePorts.length > 0 ? 50 : 0)
    })()
  }
  const schedule =
    typeof requestIdleCallback === 'function'
      ? (fn: () => void) => requestIdleCallback(fn, { timeout: 3000 })
      : (fn: () => void) => setTimeout(fn, 500)
  schedule(tick)
}

type FanOutStats = {
  fetched: number
  skipped: number
  totalBytes: number
  topPorts: RefreshPortStat[]
  abortedForViewport?: boolean
  deferredLarge?: Array<{ nodeId: string; port: string }>
}

// Chunk size for the batch-endpoint value pass: bounds how many (potentially
// large) output payloads the backend assembles + JSON-serializes for ONE HTTP
// response, mirroring the intent of the old per-port OUTPUTS_REFRESH_CONCURRENCY
// cap (worst-case concurrent payload memory) now that meta+value round trips are
// collapsed from N sequential requests into a handful of batched ones.
const OUTPUTS_BATCH_CHUNK_SIZE = 24

// How many chunk POSTs may be in flight at once. Chunks used to be awaited one
// at a time, so a project switch on a graph with e.g. 240 changed ports paid
// 10 full network round trips back-to-back (~10x one chunk's latency) even
// though the backend had spare capacity. Capped (not unbounded) so worst-case
// concurrent payload memory stays bounded — same intent as OUTPUTS_BATCH_CHUNK_SIZE,
// just one dial up from "1 chunk in flight" to "a handful in flight".
const OUTPUTS_BATCH_CONCURRENCY = 4

/**
 * Batch fan-out: one POST to learn which of the visible ports actually changed
 * (`metaOnly`, cheap — no value serialization), then a handful of chunked
 * batch POSTs to fetch just those values. Replaces the O(ports) sequential
 * getNodeOutputMeta+getNodeOutput pairs that made a project switch on a graph
 * with hundreds of ports queue behind the browser's per-origin connection cap.
 * Returns `null` when the bound transport doesn't implement the batch route,
 * so the caller falls back to the legacy per-port worker pool.
 */
export async function fanOutConnectedOutputsBatch(
  get: PipelineGet,
  api: ReturnType<typeof getEditorTransport>['api'],
  ports: ReadonlyArray<{ nodeId: string; port: string }>,
  reason: RefreshReason,
): Promise<FanOutStats | null> {
  if (typeof api.getNodeOutputsBatch !== 'function') return null
  const stats: FanOutStats = { fetched: 0, skipped: 0, totalBytes: 0, topPorts: [] }
  if (ports.length === 0) return stats

  const metaRes = await api.getNodeOutputsBatch(
    ports.map((p) => ({ nodeId: p.nodeId, portId: p.port })),
    { metaOnly: true },
  )
  if (metaRes === null) return null // transport advertised support but declined — fall back

  const metaByKey = new Map(metaRes.map((r) => [`${r.nodeId}\u0000${r.portId}`, r.meta]))
  const changed: Array<{ nodeId: string; port: string }> = []
  for (const p of ports) {
    const meta = metaByKey.get(`${p.nodeId}\u0000${p.port}`) ?? null
    const prevHash = _outputMetaByPort[p.nodeId]?.[p.port]
    const cached = get().nodeOutputs[p.nodeId]?.[p.port]
    if (meta?.valid && meta.executedHash && prevHash === meta.executedHash && cached !== undefined) {
      stats.skipped += 1
      stats.topPorts.push({ nodeId: p.nodeId, port: p.port, bytes: 0, ms: 0, skipped: true })
      continue
    }
    const knownTooLargeHash = _knownTooLargeByPort[p.nodeId]?.[p.port]
    if (meta?.valid && meta.executedHash && knownTooLargeHash === meta.executedHash) {
      // Already confirmed tooLarge at this exact executedHash — nothing has
      // re-executed since, so re-fetching would just re-derive the same verdict.
      if (!isTooLargeOutputSummary(cached)) {
        applyTooLargeOutputSummary(get, p.nodeId, p.port, meta)
      }
      stats.skipped += 1
      stats.topPorts.push({ nodeId: p.nodeId, port: p.port, bytes: 0, ms: 0, skipped: true })
      continue
    }
    changed.push(p)
  }

  if (isViewportMoving()) {
    deferRefreshUntilViewportEnd(reason)
    return { ...stats, abortedForViewport: true }
  }

  const chunks: Array<Array<{ nodeId: string; port: string }>> = []
  for (let i = 0; i < changed.length; i += OUTPUTS_BATCH_CHUNK_SIZE) {
    chunks.push(changed.slice(i, i + OUTPUTS_BATCH_CHUNK_SIZE))
  }

  const deferredLarge: Array<{ nodeId: string; port: string }> = []

  const runChunk = async (chunk: Array<{ nodeId: string; port: string }>): Promise<void> => {
    const t0 = performance.now()
    let res: Awaited<ReturnType<typeof api.getNodeOutputsBatch>>
    try {
      res = await api.getNodeOutputsBatch(chunk.map((p) => ({ nodeId: p.nodeId, portId: p.port })))
    } catch (err) {
      for (const p of chunk) syncTrace('probe:fetch-error', { nodeId: p.nodeId, port: p.port, error: String(err) })
      return
    }
    if (res === null) return
    const msPerPort = chunk.length > 0 ? (performance.now() - t0) / chunk.length : 0
    for (const r of res) {
      if (r.tooLarge) {
        deferredLarge.push({ nodeId: r.nodeId, port: r.portId })
        applyTooLargeOutputSummary(get, r.nodeId, r.portId, r.meta, r.estimatedBytes)
        stats.fetched += 1
        stats.topPorts.push({ nodeId: r.nodeId, port: r.portId, bytes: 0, ms: msPerPort, skipped: false })
        continue
      }
      // Phase-2 envelope (see scene-generator-scene-tree-storage.md §3): when
      // `r.blobs` is present, `r.value` has `{ __outputCacheBlobRef }` placeholders
      // in place of a repeated large field (e.g. a shared decoration tree) —
      // hydrate back to the normal shape BEFORE it ever reaches nodeOutputs, so
      // every downstream consumer (probes, tooltips, the renderer iframe) stays
      // completely unaware the wire format was ever deduped. A no-op when `blobs`
      // is absent (the common, non-enveloped case).
      const value = hydrateBlobRefs(r.value, r.blobs)
      const bytes = estimateValueBytes(value)
      if (value !== undefined) {
        get().setNodeOutput(r.nodeId, r.portId, value)
        if (r.meta?.executedHash) {
          if (!_outputMetaByPort[r.nodeId]) _outputMetaByPort[r.nodeId] = {}
          _outputMetaByPort[r.nodeId][r.portId] = r.meta.executedHash
        }
      } else {
        syncTrace('probe:fetch-empty', {
          nodeId: r.nodeId,
          port: r.portId,
          valid: r.meta?.valid,
          sharded: r.meta?.sharded,
        })
      }
      stats.fetched += 1
      stats.totalBytes += bytes
      stats.topPorts.push({ nodeId: r.nodeId, port: r.portId, bytes, ms: msPerPort, skipped: false })
    }
  }

  // Bounded worker pool: up to OUTPUTS_BATCH_CONCURRENCY chunk POSTs in flight
  // at once instead of one-at-a-time, so N chunks cost ~N/concurrency round
  // trips instead of N. Each worker re-checks isViewportMoving() before
  // claiming its next chunk so an in-progress drag still stops picking up
  // new work promptly; already-in-flight chunks are left to finish rather
  // than aborted mid-request.
  let cursor = 0
  let abortedForViewport = false
  const worker = async (): Promise<void> => {
    while (cursor < chunks.length) {
      if (isViewportMoving()) {
        abortedForViewport = true
        return
      }
      const chunk = chunks[cursor]
      cursor += 1
      await runChunk(chunk)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(OUTPUTS_BATCH_CONCURRENCY, chunks.length) }, () => worker()),
  )

  if (abortedForViewport) {
    deferRefreshUntilViewportEnd(reason)
    return { ...stats, abortedForViewport: true, ...(deferredLarge.length ? { deferredLarge } : {}) }
  }
  return { ...stats, ...(deferredLarge.length ? { deferredLarge } : {}) }
}

/**
 * One fan-out pass for refreshConnectedOutputs: collect every distinct visible /
 * wire-feeding output port, then hydrate their cached values. Prefers the
 * batch endpoint (one metaOnly POST + a handful of chunked value POSTs); falls
 * back to the legacy per-port worker pool when the bound transport doesn't
 * implement it (so a large graph never opens hundreds of parallel GETs either way).
 */
export async function fanOutConnectedOutputs(
  get: PipelineGet,
  reason: RefreshReason,
): Promise<{ fetched: number; skipped: number; totalBytes: number; topPorts: RefreshPortStat[]; abortedForViewport?: boolean; deferredLarge?: Array<{ nodeId: string; port: string }> }> {
  const stats = { fetched: 0, skipped: 0, totalBytes: 0, topPorts: [] as RefreshPortStat[] }
  const deferredLarge: Array<{ nodeId: string; port: string }> = []
  const scope = fanOutScopeForReason(reason)
  const { currentPipeline, batteries, dynamicOutputPorts } = get()
  if (!currentPipeline) return stats
  if (isViewportMoving()) {
    deferRefreshUntilViewportEnd(reason)
    return { ...stats, abortedForViewport: true }
  }
  const { api } = getEditorTransport()
  // Catalog gate: the 'all' scope needs the battery catalog to know each node's
  // output ports. `loadBatteries()` is async, so a mount / project-switch pass
  // can land first and silently degrade to edge-sourced ports only — a node with
  // NO outgoing edge (a text panel parked on the canvas is the visible case)
  // then never gets its cached output hydrated, and its port probe reads "no
  // result" forever even though the kernel cache holds a value. Remember the
  // miss and let the catalog's arrival re-run the pass.
  if (scope === 'all' && batteries.length === 0 && currentPipeline.nodes.some((n) => n.batteryId !== '__group__')) {
    _fanOutMissedCatalog = true
    syncTrace('probe:fanout-awaiting-catalog', { reason, nodes: currentPipeline.nodes.length })
  }
  const ports = collectVisibleOutputPorts(currentPipeline, batteries, dynamicOutputPorts, scope)

  const batchStats = await fanOutConnectedOutputsBatch(get, api, ports, reason)
  if (batchStats) return batchStats

  let cursor = 0
  let abortedForViewport = false
  const worker = async (): Promise<void> => {
    while (cursor < ports.length) {
      if (isViewportMoving()) {
        abortedForViewport = true
        return
      }
      const { nodeId, port } = ports[cursor]
      cursor += 1
      const t0 = performance.now()
      try {
        let meta: { executedHash: string; valid: boolean; sharded?: boolean; dataChunks?: number } | null = null
        try {
          meta = await api.getNodeOutputMeta(nodeId, port)
        } catch {
          /* meta endpoint optional */
        }
        if (isViewportMoving()) {
          abortedForViewport = true
          return
        }
        const prevHash = _outputMetaByPort[nodeId]?.[port]
        const cached = get().nodeOutputs[nodeId]?.[port]
        if (meta?.valid && meta.executedHash && prevHash === meta.executedHash && cached !== undefined) {
          stats.skipped += 1
          stats.topPorts.push({ nodeId, port, bytes: 0, ms: performance.now() - t0, skipped: true })
          continue
        }
        if (isViewportMoving()) {
          abortedForViewport = true
          return
        }
        const value = await api.getNodeOutput(nodeId, port)
        const ms = performance.now() - t0
        const bytes = estimateValueBytes(value)
        if (value !== undefined) {
          get().setNodeOutput(nodeId, port, value)
          if (meta?.executedHash) {
            if (!_outputMetaByPort[nodeId]) _outputMetaByPort[nodeId] = {}
            _outputMetaByPort[nodeId][port] = meta.executedHash
          }
        } else {
          syncTrace('probe:fetch-empty', {
            nodeId,
            port,
            valid: meta?.valid,
            sharded: meta?.sharded,
            missing: (meta as { missing?: boolean } | null)?.missing,
          })
        }
        stats.fetched += 1
        stats.totalBytes += bytes
        stats.topPorts.push({ nodeId, port, bytes, ms, skipped: false })
      } catch (err) {
        syncTrace('probe:fetch-error', { nodeId, port, error: String(err) })
        /* port has no value yet / transient — ignore */
      }
    }
  }
  const workerCount = Math.min(OUTPUTS_REFRESH_CONCURRENCY, ports.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  if (abortedForViewport) deferRefreshUntilViewportEnd(reason)
  return {
    ...stats,
    ...(abortedForViewport ? { abortedForViewport: true } : {}),
    ...(deferredLarge.length > 0 ? { deferredLarge } : {}),
  }
}

/** Store-method factory: coalesced refreshConnectedOutputs. */
export function createRefreshConnectedOutputs(
  get: PipelineGet,
  set: PipelineSet,
  getLastSyncedHash: () => string | null,
): (reason?: RefreshReason) => Promise<void> {
  return (reason: RefreshReason = 'manual') => {
    try {
      getEditorTransport()
    } catch {
      return Promise.resolve()
    }
    if (isViewportMoving()) {
      deferRefreshUntilViewportEnd(reason)
      return Promise.resolve()
    }
    if (reason === 'mount' && _mountRefreshInFlight) return _mountRefreshInFlight
    // Coalesce bursts: if a fan-out is already running, request a single trailing
    // pass (so the latest graph is hydrated) and share the in-flight promise
    // instead of launching another full GET storm.
    if (_outputsRefreshInFlight) {
      // Mount is idempotent — don't queue trailing passes (StrictMode double effect).
      if (reason === 'mount') return _outputsRefreshInFlight
      _outputsRefreshAgain = true
      return _outputsRefreshInFlight
    }
    const runOnce = async (): Promise<void> => {
      do {
        _outputsRefreshAgain = false
        const { currentPipeline } = get()
        const scope = fanOutScopeForReason(reason)
        const portEstimate =
          scope === 'edges'
            ? (currentPipeline?.edges.length ?? 0)
            : currentPipeline
              ? currentPipeline.edges.length + currentPipeline.nodes.length * 2
              : 0
        const startedAt = logRefreshStart(reason, { portCount: portEstimate, lastSyncedHash: getLastSyncedHash() })
        const stats = await fanOutConnectedOutputs(get, reason)
        logRefreshEnd(reason, startedAt, stats)
        if (stats.deferredLarge?.length) {
          scheduleDeferredLargePortHydration(get, stats.deferredLarge)
        }
      } while (_outputsRefreshAgain)
    }
    set({ outputsRefreshBusy: true })
    const run = runOnce().finally(() => {
      _outputsRefreshInFlight = null
      if (reason === 'mount') _mountRefreshInFlight = null
      set({ outputsRefreshBusy: false })
    })
    _outputsRefreshInFlight = run
    if (reason === 'mount') _mountRefreshInFlight = run
    return run
  }
}
