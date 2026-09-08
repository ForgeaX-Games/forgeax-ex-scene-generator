import { describe, expect, it } from 'vitest'
import { summarizeExecutionResult } from '../src/execution-summary.js'

describe('summarizeExecutionResult — keeps execute results KB-scale', () => {
  it('preserves status/error/duration verbatim and never inlines big payloads', () => {
    const bigBase64 = 'A'.repeat(500_000)
    const full = {
      executionId: 'exec-1',
      status: 'completed' as const,
      durationMs: 42,
      outputs: {
        node_img: {
          out_0: [
            // One branch with a heavy image object payload + a bare base64 string.
            { path: [0], items: [{ base64: bigBase64, width: 16, height: 16, mimeType: 'image/png' }] },
            { path: [1], items: [bigBase64] },
          ],
        },
      },
    }

    const summary = summarizeExecutionResult(full) as Record<string, any>
    const serialized = JSON.stringify(summary)

    // The 500KB base64 must NOT survive anywhere in the summary.
    expect(serialized).not.toContain(bigBase64)
    expect(serialized.length).toBeLessThan(2_000)

    // Status signal is preserved exactly so the agent can still judge success.
    expect(summary.status).toBe('completed')
    expect(summary.durationMs).toBe(42)
    expect(summary.summarized).toBe(true)

    const port = summary.outputs.node_img.out_0
    expect(port.itemCount).toBe(2)
    // The object item keeps its small dimensions but only reports keys, not pixels.
    expect(port.items[0]).toMatchObject({ kind: 'object', width: 16, height: 16, mimeType: 'image/png' })
    expect(port.items[0].keys).toContain('base64')
    // The bare base64 string collapses to a shape note (spread alongside its path).
    expect(port.items[1]).toMatchObject({ kind: 'string', length: 500_000 })
  })

  it('passes small scalars through and reports errors', () => {
    const summary = summarizeExecutionResult({
      executionId: 'e2',
      status: 'error',
      durationMs: 5,
      error: { nodeId: 'n1', message: 'boom' },
      outputs: { n1: { out_0: [{ path: [0], items: ['ok', 7, true] }] } },
    }) as Record<string, any>

    expect(summary.status).toBe('error')
    expect(summary.error).toEqual({ nodeId: 'n1', message: 'boom' })
    const items = summary.outputs.n1.out_0.items
    expect(items).toEqual([
      { path: [0], value: 'ok' },
      { path: [0], value: 7 },
      { path: [0], value: true },
    ])
  })
})
