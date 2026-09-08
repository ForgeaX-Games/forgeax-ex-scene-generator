import { describe, expect, it } from 'vitest'
import { createAiRateLock } from '../src/ai/rateLock.js'

describe('AI rate lock', () => {
  it('accepts a normal single request and releases it', () => {
    const lock = createAiRateLock()
    const r = lock.acquire('image:n1')
    expect(r.ok).toBe(true)
    lock.release('image:n1')
  })

  it('rejects a concurrent duplicate of the same key (in-flight)', () => {
    const lock = createAiRateLock()
    expect(lock.acquire('image:n1').ok).toBe(true) // not released → still in-flight
    const dup = lock.acquire('image:n1')
    expect(dup.ok).toBe(false)
    expect(dup.reason).toBe('in-flight')
  })

  it('rejects a same-key request that fires again too soon', () => {
    let t = 0
    const lock = createAiRateLock({ minIntervalMs: 600, now: () => t })
    expect(lock.acquire('image:n1').ok).toBe(true)
    lock.release('image:n1')
    t = 100 // < 600ms later
    const tooSoon = lock.acquire('image:n1')
    expect(tooSoon.ok).toBe(false)
    expect(tooSoon.reason).toBe('too-soon')
    t = 700 // past the interval
    expect(lock.acquire('image:n1').ok).toBe(true)
  })

  it('trips a global cooldown lock on a burst, rejecting everything until it expires', () => {
    let t = 0
    const lock = createAiRateLock({ minIntervalMs: 0, burstWindowMs: 1000, burstMax: 5, lockMs: 3000, now: () => t })
    // 5 accepted requests (distinct keys, released immediately) within the window.
    for (let i = 0; i < 5; i++) {
      t = i // distinct timestamps, all < 1000ms apart
      const r = lock.acquire(`image:n${i}`)
      expect(r.ok).toBe(true)
      lock.release(`image:n${i}`)
    }
    // 6th within the window → burst breaker engages.
    t = 6
    const burst = lock.acquire('image:n6')
    expect(burst.ok).toBe(false)
    expect(burst.reason).toBe('burst')
    // Still locked before cooldown expires (even a brand-new key is rejected).
    t = 2000
    const stillLocked = lock.acquire('image:fresh')
    expect(stillLocked.ok).toBe(false)
    expect(stillLocked.reason).toBe('locked')
    // After the cooldown a fresh request is accepted again.
    t = 6 + 3000
    expect(lock.acquire('image:after').ok).toBe(true)
  })

  it('does not count rejected attempts toward the burst window', () => {
    let t = 0
    const lock = createAiRateLock({ minIntervalMs: 0, burstWindowMs: 1000, burstMax: 3, lockMs: 1000, now: () => t })
    // 2 accepted.
    lock.acquire('image:a'); lock.release('image:a')
    t = 1
    lock.acquire('image:b'); lock.release('image:b')
    // A concurrent dup of an in-flight key is rejected and must NOT add to recent.
    t = 2
    expect(lock.acquire('image:c').ok).toBe(true) // 3rd accepted, left in-flight
    const dup = lock.acquire('image:c')
    expect(dup.reason).toBe('in-flight')
    lock.release('image:c')
    // recent has exactly 3 (a,b,c) → next within window should NOT yet trip burst
    // because burstMax is 3 and the check is >= burstMax BEFORE pushing... so the
    // 4th accepted attempt trips it. Verify the rejected dup did not pre-trip it.
    t = 3
    const fourth = lock.acquire('image:d')
    expect(fourth.ok).toBe(false)
    expect(fourth.reason).toBe('burst')
  })
})
