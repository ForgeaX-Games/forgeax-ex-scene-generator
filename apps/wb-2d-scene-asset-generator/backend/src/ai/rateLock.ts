// Lowest-level guard in front of the expensive AI gateway calls
// (`/api/v1/ai/image|text`). A runaway frontend loop or a misbehaving agent can
// otherwise hammer the Studio image/text gateway dozens of times per second.
// This lock is the LAST line of defence — it sits at the route entry, before any
// resolve/generate work, and:
//
//   1. drops concurrent duplicates of the same key (same node already running),
//   2. drops a same-key request that fires again within `minIntervalMs`,
//   3. trips a global cooldown lock when too many requests arrive inside
//      `burstWindowMs` (`burstMax`), rejecting everything for `lockMs`.
//
// State is intentionally per-instance (created once per `registerAiRoutes`): in
// production the backend builds the app once → one process-wide lock; tests build
// a fresh app per case → naturally isolated, no cross-test bleed.

export interface AiRateLockResult {
  ok: boolean
  /** Machine-readable rejection cause: 'in-flight' | 'too-soon' | 'burst' | 'locked'. */
  reason?: 'in-flight' | 'too-soon' | 'burst' | 'locked'
  /** Hint for the caller: how long until a retry could succeed. */
  retryAfterMs?: number
}

export interface AiRateLockOptions {
  /** Reject a 2nd request for the SAME key within this window. Default 600ms. */
  minIntervalMs?: number
  /** Sliding window for burst detection. Default 1000ms. */
  burstWindowMs?: number
  /** Max accepted requests within `burstWindowMs` before the cooldown trips. Default 10. */
  burstMax?: number
  /** Cooldown duration once a burst trips (everything rejected). Default 3000ms. */
  lockMs?: number
  /** Injectable clock (tests). */
  now?: () => number
}

export interface AiRateLock {
  /** Try to take the lock for `key`. On `ok:true` the caller MUST `release(key)`. */
  acquire(key: string): AiRateLockResult
  release(key: string): void
}

export function createAiRateLock(opts: AiRateLockOptions = {}): AiRateLock {
  const minIntervalMs = opts.minIntervalMs ?? 600
  const burstWindowMs = opts.burstWindowMs ?? 1000
  const burstMax = opts.burstMax ?? 10
  const lockMs = opts.lockMs ?? 3000
  const now = opts.now ?? (() => Date.now())

  const inFlight = new Set<string>()
  const lastAt = new Map<string, number>()
  let recent: number[] = []
  let lockedUntil = 0

  return {
    acquire(key: string): AiRateLockResult {
      const t = now()
      // A burst already tripped the cooldown: reject everything until it expires.
      if (t < lockedUntil) {
        return { ok: false, reason: 'locked', retryAfterMs: lockedUntil - t }
      }
      // Same node/anon still running: never fire a concurrent duplicate.
      if (inFlight.has(key)) {
        return { ok: false, reason: 'in-flight', retryAfterMs: minIntervalMs }
      }
      // Same key fired again too soon.
      const last = lastAt.get(key)
      if (last !== undefined && t - last < minIntervalMs) {
        return { ok: false, reason: 'too-soon', retryAfterMs: minIntervalMs - (t - last) }
      }
      // Sliding-window burst breaker (counts ALL accepted AI calls, any key).
      recent = recent.filter((ts) => t - ts < burstWindowMs)
      if (recent.length >= burstMax) {
        lockedUntil = t + lockMs
        return { ok: false, reason: 'burst', retryAfterMs: lockMs }
      }
      recent.push(t)
      lastAt.set(key, t)
      inFlight.add(key)
      return { ok: true }
    },
    release(key: string): void {
      inFlight.delete(key)
    },
  }
}
