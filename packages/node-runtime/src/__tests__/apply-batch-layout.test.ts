// Incremental edge-aware layout for nodes added without explicit `position`.

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyBatch, createRuntime, getPipeline } from '../layer2/index.js'
import type { OpSpec } from '../layer1/index.js'

let scratch: string

beforeEach(() => {
  scratch = join(tmpdir(), `forgeax-layout-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratch, { recursive: true })
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const sourceOp: OpSpec = {
  id: 'kernel.source',
  inputs: [],
  outputs: [{ name: 'out', type: 'number', access: 'item' }],
  params: [{ name: 'value', type: 'number' }],
  execute: (_ctx, args) => ({ out: args.value }),
}
const sinkOp: OpSpec = {
  id: 'kernel.sink',
  inputs: [{ name: 'in', type: 'number', access: 'item', default: 0 }],
  outputs: [{ name: 'out', type: 'number', access: 'item' }],
  params: [],
  execute: (_ctx, args) => ({ out: args.in }),
}
const mergeOp: OpSpec = {
  id: 'kernel.merge',
  inputs: [{ name: 'in_0', type: 'number', access: 'item', default: 0 }],
  outputs: [{ name: 'out', type: 'number', access: 'item' }],
  dynamicInputs: { prefix: 'in_', type: 'number', access: 'item' },
  params: [{ name: 'portCount', type: 'number', default: 2 }],
  execute: (_ctx, args) => ({ out: args.in_0 }),
}

function fresh() {
  const runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'plugin.test' })
  runtime.registry.register(sourceOp)
  runtime.registry.register(sinkOp)
  runtime.registry.register(mergeOp)
  return runtime
}

describe('applyBatch incremental layout', () => {
  it('places a new node to the right of an existing source it connects from', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'src', opId: 'kernel.source', position: { x: 100, y: 200 }, params: { value: 1 } },
    ])
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'sink', opId: 'kernel.sink', params: {} },
      { type: 'connect', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'sink', port: 'in' } },
    ])
    const snap = getPipeline(runtime)!
    expect(snap.nodes.src!.position).toEqual({ x: 100, y: 200 })
    expect(snap.nodes.sink!.position.x).toBeGreaterThan(100)
  })

  it('stacks parallel new branches vertically without moving the existing anchor', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'src', opId: 'kernel.source', position: { x: 0, y: 100 }, params: { value: 1 } },
    ])
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'b', opId: 'kernel.sink', params: {} },
      { type: 'createNode', nodeId: 'c', opId: 'kernel.sink', params: {} },
      { type: 'connect', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'b', port: 'in' } },
      { type: 'connect', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'c', port: 'in' } },
    ])
    const snap = getPipeline(runtime)!
    expect(snap.nodes.src!.position).toEqual({ x: 0, y: 100 })
    expect(snap.nodes.b!.position.y).not.toBe(snap.nodes.c!.position.y)
    expect(snap.nodes.b!.position.x).toBe(snap.nodes.c!.position.x)
  })

  it('places a feeder to the left of an existing target', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'merge', opId: 'kernel.merge', position: { x: 500, y: 50 }, params: { portCount: 2 } },
    ])
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'feed', opId: 'kernel.source', params: { value: 3 } },
      { type: 'connect', source: { nodeId: 'feed', port: 'out' }, target: { nodeId: 'merge', port: 'in_0' } },
    ])
    const snap = getPipeline(runtime)!
    expect(snap.nodes.merge!.position).toEqual({ x: 500, y: 50 })
    expect(snap.nodes.feed!.position.x).toBeLessThan(500)
  })

  it('preserves explicit position and never moves pre-existing nodes', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'old', opId: 'kernel.source', position: { x: 77, y: 88 }, params: { value: 1 } },
      { type: 'createNode', nodeId: 'pinned', opId: 'kernel.sink', position: { x: 300, y: 400 }, params: {} },
    ])
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'auto', opId: 'kernel.sink', params: {} },
      { type: 'connect', source: { nodeId: 'old', port: 'out' }, target: { nodeId: 'auto', port: 'in' } },
    ])
    const snap = getPipeline(runtime)!
    expect(snap.nodes.old!.position).toEqual({ x: 77, y: 88 })
    expect(snap.nodes.pinned!.position).toEqual({ x: 300, y: 400 })
    expect(snap.nodes.auto!.position.x).toBeGreaterThan(77)
  })

  it('chains multiple new nodes left-to-right within one batch', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'a', opId: 'kernel.source', params: { value: 1 } },
      { type: 'createNode', nodeId: 'b', opId: 'kernel.sink', params: {} },
      { type: 'createNode', nodeId: 'c', opId: 'kernel.sink', params: {} },
      { type: 'connect', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'b', port: 'in' } },
      { type: 'connect', source: { nodeId: 'b', port: 'out' }, target: { nodeId: 'c', port: 'in' } },
    ])
    const snap = getPipeline(runtime)!
    expect(snap.nodes.a!.position.x).toBeLessThan(snap.nodes.b!.position.x)
    expect(snap.nodes.b!.position.x).toBeLessThan(snap.nodes.c!.position.x)
  })

  it('stacks isolated nodes in one expansion column (no diagonal drift)', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'anchor', opId: 'kernel.source', position: { x: 100, y: 200 }, params: { value: 1 } },
    ])
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'i1', opId: 'kernel.sink', params: {} },
      { type: 'createNode', nodeId: 'i2', opId: 'kernel.sink', params: {} },
      { type: 'createNode', nodeId: 'i3', opId: 'kernel.sink', params: {} },
    ])
    const snap = getPipeline(runtime)!
    const xs = ['i1', 'i2', 'i3'].map((id) => snap.nodes[id]!.position.x)
    expect(new Set(xs).size).toBe(1)
    expect(snap.nodes.i2!.position.y).toBeGreaterThan(snap.nodes.i1!.position.y)
    expect(snap.nodes.i3!.position.y).toBeGreaterThan(snap.nodes.i2!.position.y)
  })

  it('aligns feeders to the same column left of the target', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'merge', opId: 'kernel.merge', position: { x: 600, y: 200 }, params: { portCount: 3 } },
    ])
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'f1', opId: 'kernel.source', params: { value: 1 } },
      { type: 'createNode', nodeId: 'f2', opId: 'kernel.source', params: { value: 2 } },
      { type: 'createNode', nodeId: 'f3', opId: 'kernel.source', params: { value: 3 } },
      { type: 'connect', source: { nodeId: 'f1', port: 'out' }, target: { nodeId: 'merge', port: 'in_0' } },
      { type: 'connect', source: { nodeId: 'f2', port: 'out' }, target: { nodeId: 'merge', port: 'in_1' } },
      { type: 'connect', source: { nodeId: 'f3', port: 'out' }, target: { nodeId: 'merge', port: 'in_2' } },
    ])
    const snap = getPipeline(runtime)!
    const xs = ['f1', 'f2', 'f3'].map((id) => snap.nodes[id]!.position.x)
    expect(new Set(xs).size).toBe(1)
    for (const id of ['f1', 'f2', 'f3']) {
      expect(snap.nodes[id]!.position.x).toBeLessThan(600)
    }
  })

  it('keeps the chain child on the parent row while forks stack below', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'src', opId: 'kernel.source', position: { x: 0, y: 200 }, params: { value: 1 } },
    ])
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'chain', opId: 'kernel.sink', params: {} },
      { type: 'createNode', nodeId: 'chain2', opId: 'kernel.sink', params: {} },
      { type: 'createNode', nodeId: 'fork1', opId: 'kernel.sink', params: {} },
      { type: 'createNode', nodeId: 'fork2', opId: 'kernel.sink', params: {} },
      { type: 'connect', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'chain', port: 'in' } },
      { type: 'connect', source: { nodeId: 'chain', port: 'out' }, target: { nodeId: 'chain2', port: 'in' } },
      { type: 'connect', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'fork1', port: 'in' } },
      { type: 'connect', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'fork2', port: 'in' } },
    ])
    const snap = getPipeline(runtime)!
    const srcCy = snap.nodes.src!.position.y + 60
    const chainCy = snap.nodes.chain!.position.y + 60
    expect(Math.abs(chainCy - srcCy)).toBeLessThan(40)
    expect(snap.nodes.chain2!.position.x).toBeGreaterThan(snap.nodes.chain!.position.x)
    expect(snap.nodes.fork1!.position.y).toBeGreaterThan(snap.nodes.chain!.position.y)
    expect(snap.nodes.fork1!.position.x).toBe(snap.nodes.chain!.position.x)
  })

  it('falls back to legacy grid when autoLayoutNew is false', async () => {
    const runtime = fresh()
    await applyBatch(
      runtime,
      [
        { type: 'createNode', nodeId: 'a', opId: 'kernel.source', params: { value: 1 } },
        { type: 'createNode', nodeId: 'b', opId: 'kernel.sink', params: {} },
        { type: 'connect', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'b', port: 'in' } },
      ],
      { autoLayoutNew: false },
    )
    const snap = getPipeline(runtime)!
    // Legacy grid: second node at (220, 0) regardless of edge direction.
    expect(snap.nodes.b!.position).toEqual({ x: 220, y: 0 })
  })
})
