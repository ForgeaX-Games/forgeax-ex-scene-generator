// Layer 2 applyBatch ephemeral option.
//
// An ephemeral batch (high-frequency intermediate state, e.g. live slider-drag
// ticks) must persist the graph + invalidate caches + emit graph:applied EXACTLY
// like a normal batch, but must NOT append an audit line to history.jsonl. The
// final committed value is written by a normal (non-ephemeral) batch, so the
// audit log records the settled state — not every drag tick.

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyBatch, createRuntime } from '../layer2/index.js'
import type { RuntimeEvent } from '../layer2/subscriptions.js'

let scratchDir: string

beforeEach(() => {
  scratchDir = join(tmpdir(), `forgeax-ephemeral-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratchDir, { recursive: true })
})

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

describe('applyBatch ephemeral option', () => {
  it('ephemeral=true persists + emits graph:applied but writes NO history entry', async () => {
    const runtime = createRuntime({
      projectRoot: scratchDir,
      pipelineId: 'peph',
      pluginId: 'plugin.test',
    })
    // Seed a node with a normal (audited) batch.
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'a', opId: 'demo.echo', position: { x: 0, y: 0 }, params: { value: 1 } },
    ])
    const baselineHistory = runtime.history.readAll().length
    expect(baselineHistory).toBe(1)

    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('peph', ['graph'], (e) => events.push(e))

    // Ephemeral param update (a drag tick).
    const result = await applyBatch(
      runtime,
      [{ type: 'updateNode', nodeId: 'a', params: { value: 2 } }],
      { ephemeral: true },
    )

    // Persisted + announced exactly like a normal batch …
    expect(result.status).toBe('ok')
    expect(runtime.graph.load()?.nodes.a?.params.value).toBe(2)
    expect(events).toHaveLength(1)
    expect(events[0].kind).toBe('graph:applied')
    // … but NO new audit line.
    expect(runtime.history.readAll()).toHaveLength(baselineHistory)
  })

  it('ephemeral=false (default) DOES write a history entry', async () => {
    const runtime = createRuntime({
      projectRoot: scratchDir,
      pipelineId: 'peph',
      pluginId: 'plugin.test',
    })
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'a', opId: 'demo.echo', position: { x: 0, y: 0 }, params: { value: 1 } },
    ])
    const baselineHistory = runtime.history.readAll().length

    // Default (no ephemeral flag) — normal audited batch.
    await applyBatch(runtime, [{ type: 'updateNode', nodeId: 'a', params: { value: 3 } }])
    expect(runtime.history.readAll()).toHaveLength(baselineHistory + 1)

    // Explicit ephemeral:false behaves identically to the default.
    await applyBatch(
      runtime,
      [{ type: 'updateNode', nodeId: 'a', params: { value: 4 } }],
      { ephemeral: false },
    )
    expect(runtime.history.readAll()).toHaveLength(baselineHistory + 2)
  })

  it('a drag burst of ephemeral ticks followed by one commit writes exactly ONE audit line', async () => {
    const runtime = createRuntime({
      projectRoot: scratchDir,
      pipelineId: 'peph',
      pluginId: 'plugin.test',
    })
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'a', opId: 'demo.echo', position: { x: 0, y: 0 }, params: { value: 0 } },
    ])
    const baselineHistory = runtime.history.readAll().length

    // Simulate ~20 drag ticks, all ephemeral.
    for (let v = 1; v <= 20; v++) {
      await applyBatch(runtime, [{ type: 'updateNode', nodeId: 'a', params: { value: v } }], { ephemeral: true })
    }
    expect(runtime.history.readAll()).toHaveLength(baselineHistory) // no audit growth during drag

    // Drag-stop commit (normal batch).
    await applyBatch(runtime, [{ type: 'updateNode', nodeId: 'a', params: { value: 20 } }])
    expect(runtime.history.readAll()).toHaveLength(baselineHistory + 1) // exactly one settled entry
    expect(runtime.graph.load()?.nodes.a?.params.value).toBe(20)
  })
})
