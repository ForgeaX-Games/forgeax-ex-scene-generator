// Regression test for "拖一下节点 / 切一次 preview，下游输出就全变 '-'":
// presentation-only batches (position drag, previewEnabled toggle) suppress the
// `graph:applied` broadcast, so anything they invalidate is never recomputed.
// They must therefore not seed output-cache invalidation at all.

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyBatch, createRuntime, executeNode } from '../layer2/index.js'
import type { OpSpec } from '../layer1/index.js'

let scratch: string

beforeEach(() => {
  scratch = join(tmpdir(), `forgeax-invalidation-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratch, { recursive: true })
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const constOp: OpSpec = {
  id: 'kernel.const',
  inputs: [],
  outputs: [{ name: 'out', type: 'number', access: 'item' }],
  params: [{ name: 'value', type: 'number' }],
  execute: (_ctx, args) => ({ out: args.value }),
}

const sinkOp: OpSpec = {
  id: 'kernel.sink',
  inputs: [{ name: 'in', type: 'number', access: 'item' }],
  outputs: [{ name: 'out', type: 'number', access: 'item' }],
  params: [],
  execute: (_ctx, args) => ({ out: args.in }),
}

async function graphWithCachedOutputs() {
  const runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'plugin.test' })
  runtime.registry.register(constOp)
  runtime.registry.register(sinkOp)
  await applyBatch(runtime, [
    { type: 'createNode', nodeId: 'src', opId: 'kernel.const', position: { x: 0, y: 0 }, params: { value: 7 } },
    { type: 'createNode', nodeId: 'sink', opId: 'kernel.sink', position: { x: 200, y: 0 }, params: {} },
    { type: 'connect', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'sink', port: 'in' } },
  ])
  await (await executeNode(runtime)).done
  expect(runtime.outputs.read('sink', 'out')?.data).toBeDefined()
  return runtime
}

describe('output-cache invalidation seeds', () => {
  it('keeps downstream caches when a node is only dragged', async () => {
    const runtime = await graphWithCachedOutputs()

    const result = await applyBatch(runtime, [
      { type: 'updateNode', nodeId: 'src', position: { x: 50, y: 50 } },
    ])

    expect(result.layoutOnly).toBe(true)
    expect(result.invalidatedNodeCount).toBe(0)
    expect(runtime.outputs.read('sink', 'out')?.data).toBeDefined()
  })

  it('keeps downstream caches when preview is toggled', async () => {
    const runtime = await graphWithCachedOutputs()

    const result = await applyBatch(runtime, [{ type: 'updateNode', nodeId: 'src', previewEnabled: false }])

    expect(result.layoutOnly).toBe(true)
    expect(result.invalidatedNodeCount).toBe(0)
    expect(runtime.outputs.read('sink', 'out')?.data).toBeDefined()
  })

  it('keeps downstream caches when only the node box is resized', async () => {
    const runtime = await graphWithCachedOutputs()

    const result = await applyBatch(runtime, [
      { type: 'updateNode', nodeId: 'src', params: { value: 7, _nodeWidth: 325, _nodeHeight: 188 } },
    ])

    expect(result.layoutOnly).toBe(true)
    expect(result.invalidatedNodeCount).toBe(0)
    expect(runtime.outputs.read('sink', 'out')?.data).toBeDefined()
  })

  it('invalidates downstream when a resize batch also changes a real param', async () => {
    const runtime = await graphWithCachedOutputs()

    const result = await applyBatch(runtime, [
      { type: 'updateNode', nodeId: 'src', params: { value: 9, _nodeWidth: 325 } },
    ])

    expect(result.layoutOnly).toBe(false)
    expect(result.invalidatedNodeCount).toBeGreaterThan(0)
    expect(runtime.outputs.read('sink', 'out')?.data).toBeUndefined()
  })

  it('still invalidates downstream on a real param edit', async () => {
    const runtime = await graphWithCachedOutputs()

    const result = await applyBatch(runtime, [{ type: 'updateNode', nodeId: 'src', params: { value: 9 } }])

    expect(result.layoutOnly).toBe(false)
    expect(result.invalidatedNodeCount).toBeGreaterThan(0)
    expect(runtime.outputs.read('sink', 'out')?.data).toBeUndefined()
  })
})
