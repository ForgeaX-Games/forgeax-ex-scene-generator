/**
 * Canvas viewport ↔ backend activity correlation for scroll/zoom perf diagnosis.
 *
 * Opt-in only — dev default is silent. Enable when investigating scroll/zoom lag:
 *   FORGEAX_CANVAS_PERF_DEBUG=1       viewport START/END + session HTTP summaries
 *   FORGEAX_CANVAS_PERF_DEBUG=verbose per-request HTTP + WS lines (very noisy)
 *
 * Set VITE_CANVAS_PERF_DEBUG=true in the frontend when using mode 1 or verbose.
 */

export function isCanvasPerfDebugEnabled(): boolean {
  const v = process.env.FORGEAX_CANVAS_PERF_DEBUG
  if (!v || v === '0' || v === 'false') return false
  return v === '1' || v === 'true' || v === 'verbose'
}

/** Per-request HTTP + WS tracing — only with DEBUG=verbose (or PERF_VERBOSE=1). */
export function isCanvasPerfVerbose(): boolean {
  if (process.env.FORGEAX_CANVAS_PERF_VERBOSE === '1') return true
  return process.env.FORGEAX_CANVAS_PERF_DEBUG === 'verbose'
}

/** Viewport considered "active" for this long after the last marker. */
const VIEWPORT_IDLE_MS = 250

interface ViewportMarker {
  phase: 'start' | 'move' | 'end'
  zoom?: number
  x?: number
  y?: number
  clientT?: number
}

interface ViewportSession {
  id: string
  startedAt: number
  lastAt: number
  moveCount: number
  lastZoom?: number
}

interface RequestBucket {
  count: number
  totalMs: number
  maxMs: number
  bytesOut: number
}

let session: ViewportSession | null = null
let lastMarker: ViewportMarker | null = null

/** Per viewport session: route key → aggregate stats (cleared on session end). */
const sessionBuckets = new Map<string, RequestBucket>()

/** Idle-window aggregates (between viewport sessions). */
const idleBuckets = new Map<string, RequestBucket>()

function nowIso(): string {
  return new Date().toISOString()
}

function routeKey(method: string, url: string): string {
  // Normalize dynamic ids so storms collapse: .../nodes/foo/outputs/bar → .../nodes/:id/outputs/:port
  const path = url.split('?')[0] ?? url
  return `${method} ${path
    .replace(/\/nodes\/[^/]+\/outputs\/[^/]+/g, '/nodes/:id/outputs/:port')
    .replace(/\/nodes\/[^/]+/g, '/nodes/:id')
    .replace(/\/groups\/[^/]+/g, '/groups/:id')}`
}

function bumpBucket(map: Map<string, RequestBucket>, key: string, ms: number, bytesOut: number): void {
  const prev = map.get(key)
  if (!prev) {
    map.set(key, { count: 1, totalMs: ms, maxMs: ms, bytesOut })
    return
  }
  prev.count += 1
  prev.totalMs += ms
  if (ms > prev.maxMs) prev.maxMs = ms
  prev.bytesOut += bytesOut
}

function formatBucketLine(key: string, b: RequestBucket): string {
  const avg = b.count > 0 ? (b.totalMs / b.count).toFixed(1) : '0'
  const kb = b.bytesOut > 0 ? ` out=${(b.bytesOut / 1024).toFixed(1)}KB` : ''
  return `  ${key}  n=${b.count} total=${b.totalMs.toFixed(1)}ms avg=${avg}ms max=${b.maxMs.toFixed(1)}ms${kb}`
}

function flushBucketSummary(label: string, map: Map<string, RequestBucket>): void {
  if (map.size === 0) {
    console.log(`[canvas-perf] ${label} (no HTTP traffic)`)
    return
  }
  const lines = [...map.entries()]
    .sort((a, b) => b[1].totalMs - a[1].totalMs)
    .map(([k, b]) => formatBucketLine(k, b))
  console.log(`[canvas-perf] ${label}\n${lines.join('\n')}`)
  map.clear()
}

export function isViewportActive(): boolean {
  if (!session) return false
  return Date.now() - session.lastAt < VIEWPORT_IDLE_MS
}

export function markViewportEvent(marker: ViewportMarker): void {
  if (!isCanvasPerfDebugEnabled()) return

  const t = Date.now()
  lastMarker = marker

  if (marker.phase === 'start' || !session) {
    if (session && marker.phase === 'start') {
      flushBucketSummary(`viewport session ${session.id} HTTP summary`, sessionBuckets)
      console.log(
        `[canvas-perf] viewport session ${session.id} ended (interrupted by new start) moves=${session.moveCount} duration=${t - session.startedAt}ms`,
      )
    }
    session = {
      id: `${t.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      startedAt: t,
      lastAt: t,
      moveCount: 0,
      lastZoom: marker.zoom,
    }
    console.log(
      `[canvas-perf] viewport START session=${session.id} zoom=${marker.zoom ?? '?'} x=${marker.x ?? '?'} y=${marker.y ?? '?'}`,
    )
    return
  }

  session.lastAt = t
  if (marker.phase === 'move') session.moveCount += 1
  if (marker.zoom !== undefined) session.lastZoom = marker.zoom

  if (marker.phase === 'end') {
    const dur = t - session.startedAt
    console.log(
      `[canvas-perf] viewport END session=${session.id} moves=${session.moveCount} duration=${dur}ms lastZoom=${session.lastZoom ?? '?'}`,
    )
    flushBucketSummary(`viewport session ${session.id} HTTP summary`, sessionBuckets)
    session = null
  }
}

export function logHttpRequest(
  method: string,
  url: string,
  statusCode: number,
  durationMs: number,
  bytesOut = 0,
): void {
  if (!isCanvasPerfDebugEnabled()) return

  const during = isViewportActive()
  const tag = during ? 'DURING_VIEWPORT' : 'idle'
  const sid = session?.id ?? '-'
  const key = routeKey(method, url)

  if (during) bumpBucket(sessionBuckets, key, durationMs, bytesOut)
  else bumpBucket(idleBuckets, key, durationMs, bytesOut)

  if (!isCanvasPerfVerbose()) return

  const outKb = bytesOut > 0 ? ` out=${(bytesOut / 1024).toFixed(1)}KB` : ''
  console.log(
    `[canvas-perf] ${nowIso()} ${tag} session=${sid} ${method} ${url} → ${statusCode} ${durationMs.toFixed(1)}ms${outKb}`,
  )
}

export function logWsRuntimeEvent(channel: string, kind: string, extra?: string): void {
  if (!isCanvasPerfVerbose()) return
  const during = isViewportActive()
  const tag = during ? 'DURING_VIEWPORT' : 'idle'
  const sid = session?.id ?? '-'
  console.log(
    `[canvas-perf] ${nowIso()} ${tag} session=${sid} WS ${channel}:${kind}${extra ? ` ${extra}` : ''}`,
  )
}

export function logPerfDebugStartup(): void {
  if (!isCanvasPerfDebugEnabled()) return
  const mode = isCanvasPerfVerbose() ? 'verbose (per-request HTTP/WS)' : 'summary (viewport sessions only)'
  console.log(
    `[canvas-perf] enabled (${mode}) — set VITE_CANVAS_PERF_DEBUG=true in frontend to POST viewport markers`,
  )
}

/** Periodic idle summary (optional hook from main). */
export function flushIdleHttpSummaryIfAny(): void {
  if (!isCanvasPerfDebugEnabled() || idleBuckets.size === 0) return
  flushBucketSummary('idle window HTTP summary', idleBuckets)
}
