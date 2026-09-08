/**
 * Frontend refresh / persist tracing — pairs with backend [persist-trace].
 * Opt-in: localStorage.setItem('wb-scene-generator.debugSync', 'true')
 */

const LS_KEY = 'wb-scene-generator.debugSync'

export function refreshTraceEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(LS_KEY) === 'true'
  } catch {
    return false
  }
}
export type RefreshReason =
  | 'graph:applied'
  | 'reconcile'
  | 'exec:completed'
  | 'mount'
  | 'mount-deferred'
  | 'project-switch'
  | 'manual'
  | 'autoexec-backfill'

export interface RefreshPortStat {
  nodeId: string
  port: string
  bytes: number
  ms: number
  skipped: boolean
}

let _persistReason: string | undefined

export function setPersistTraceReason(reason: string | undefined): void {
  _persistReason = reason
}

export function getPersistTraceReason(): string | undefined {
  return _persistReason
}

function enabled(): boolean {
  return refreshTraceEnabled()
}

export function logPersistSchedule(reason: string): void {
  if (!enabled()) return
  console.log(`[persist-trace] SCHEDULE reason=${reason} debounceMs=500`)
}

export function logPersistFlush(reason?: string): void {
  if (!enabled()) return
  console.log(`[persist-trace] FLUSH reason=${reason ?? _persistReason ?? '?'}`)
}

export function logPersistDone(opts: {
  status: string
  newHash?: string
  layoutOnly?: boolean
  lastSyncedHashUpdated: boolean
  durationMs: number
}): void {
  if (!enabled()) return
  console.log(
    `[persist-trace] DONE status=${opts.status} layoutOnly=${opts.layoutOnly ?? '?'} ` +
      `newHash=${opts.newHash?.slice(0, 12) ?? '-'}… lastSyncedHashUpdated=${opts.lastSyncedHashUpdated} ` +
      `durationMs=${opts.durationMs.toFixed(1)} reason=${_persistReason ?? '?'}`,
  )
}

export function logRefreshStart(reason: RefreshReason, opts: { portCount: number; lastSyncedHash: string | null }): number {
  if (!enabled()) return performance.now()
  console.log(
    `[refresh-trace] START reason=${reason} portCount=${opts.portCount} lastSyncedHash=${opts.lastSyncedHash?.slice(0, 12) ?? 'null'}…`,
  )
  return performance.now()
}

export function logRefreshEnd(
  reason: RefreshReason,
  startedAt: number,
  stats: { fetched: number; skipped: number; totalBytes: number; topPorts: RefreshPortStat[] },
): void {
  if (!enabled()) return
  const dur = performance.now() - startedAt
  const top = stats.topPorts
    .filter((p) => !p.skipped)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5)
    .map((p) => `${p.nodeId}/${p.port}=${(p.bytes / 1024).toFixed(0)}KB`)
    .join(', ')
  console.log(
    `[refresh-trace] END reason=${reason} durationMs=${dur.toFixed(1)} ` +
      `fetched=${stats.fetched} skipped=${stats.skipped} totalBytes=${(stats.totalBytes / (1024 * 1024)).toFixed(2)}MB` +
      (top ? ` top=[${top}]` : ''),
  )
}

/** Rough JSON byte size for tracing (not exact on all platforms). */
export function estimateValueBytes(value: unknown): number {
  if (value === undefined) return 0
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length
  } catch {
    return 0
  }
}
