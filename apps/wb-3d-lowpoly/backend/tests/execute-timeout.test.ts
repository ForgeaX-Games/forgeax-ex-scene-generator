/**
 * `/execute` and `/execute/summary` previously awaited `handle.done` with no
 * guard at all — unlike `model.apply`, which has raced `executeNode` against
 * `executeTimeoutMs()` since the "卡死治理" (stuck-pipeline remediation) work.
 * A pipeline execution that hangs (pathological CSG/gear/architecture bake,
 * OCCT WASM spin) on these two routes just held the HTTP response open forever
 * — from the agent's side indistinguishable from "the conversation suddenly
 * cut off". This covers the `runWithTimeout` wrapper in isolation (a real
 * hang is impractical to reproduce cheaply in a unit test).
 */
import { describe, it, expect } from 'vitest'
import { runWithTimeout } from '../src/routes/execute.js'

function neverResolves(): Promise<unknown> {
  return new Promise(() => {})
}

describe('runWithTimeout (execute routes)', () => {
  it('returns a bounded {status:"timeout"} result instead of hanging forever', async () => {
    const before = process.env.FORGEAX_EXECUTE_TIMEOUT_MS
    process.env.FORGEAX_EXECUTE_TIMEOUT_MS = '25'
    try {
      const result = (await runWithTimeout('test-hang', neverResolves())) as {
        status: string
        error?: { message: string }
        durationMs: number
      }
      expect(result.status).toBe('timeout')
      expect(result.error?.message).toMatch(/test-hang timed out after 25ms/)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    } finally {
      if (before === undefined) delete process.env.FORGEAX_EXECUTE_TIMEOUT_MS
      else process.env.FORGEAX_EXECUTE_TIMEOUT_MS = before
    }
  })

  it('passes through the resolved value when execution finishes before the deadline', async () => {
    const result = await runWithTimeout('test-fast', Promise.resolve({ status: 'completed', durationMs: 1 }))
    expect(result).toEqual({ status: 'completed', durationMs: 1 })
  })

  it('re-throws non-timeout errors unchanged', async () => {
    await expect(runWithTimeout('test-error', Promise.reject(new Error('boom')))).rejects.toThrow('boom')
  })
})
