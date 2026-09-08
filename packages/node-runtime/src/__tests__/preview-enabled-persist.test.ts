// Regression test for the "disable preview 状态刷新后丢失" bug: previewEnabled
// must round-trip through graph.json like any other node field (position/params),
// not be dropped on save/reload. See root CHANGELOG.md for the postmortem.

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyBatch, batchIsLayoutOnly, createRuntime, getPipeline } from '../layer2/index.js'
import type { OpSpec } from '../layer1/index.js'

let scratch: string

beforeEach(() => {
  scratch = join(tmpdir(), `forgeax-preview-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratch, { recursive: true })
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const echoOp: OpSpec = {
  id: 'kernel.echo',
  inputs: [],
  outputs: [{ name: 'out', type: 'number', access: 'item' }],
  params: [{ name: 'value', type: 'number' }],
  execute: (_ctx, args) => ({ out: args.value }),
}

function fresh() {
  const runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'plugin.test' })
  runtime.registry.register(echoOp)
  return runtime
}

describe('previewEnabled persistence', () => {
  it('persists previewEnabled: false set at createNode time across a fresh load', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'a', opId: 'kernel.echo', position: { x: 0, y: 0 }, params: { value: 1 }, previewEnabled: false },
    ])
    // Simulate "refresh the page": read the persisted graph.json back from disk.
    const reloaded = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'plugin.test' })
    reloaded.registry.register(echoOp)
    expect(getPipeline(reloaded)!.nodes.a!.previewEnabled).toBe(false)
  })

  it('persists a later updateNode previewEnabled toggle across a fresh load', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'a', opId: 'kernel.echo', position: { x: 0, y: 0 }, params: { value: 1 } },
    ])
    expect(getPipeline(runtime)!.nodes.a!.previewEnabled).toBeUndefined()

    await applyBatch(runtime, [{ type: 'updateNode', nodeId: 'a', previewEnabled: false }])

    const reloaded = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'plugin.test' })
    reloaded.registry.register(echoOp)
    expect(getPipeline(reloaded)!.nodes.a!.previewEnabled).toBe(false)
  })

  it('classifies a previewEnabled-only updateNode as layout-only (no spurious re-exec broadcast)', () => {
    expect(batchIsLayoutOnly([{ type: 'updateNode', nodeId: 'a', previewEnabled: false }])).toBe(true)
    expect(
      batchIsLayoutOnly([{ type: 'updateNode', nodeId: 'a', previewEnabled: false, params: { value: 2 } }]),
    ).toBe(false)
  })
})
