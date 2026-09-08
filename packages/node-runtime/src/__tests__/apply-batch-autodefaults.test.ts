// Layer 2 applyBatch headless-ergonomics: createNode.position and
// connect.edgeId are OPTIONAL. Headless callers (AI / CLI) may omit them and
// the kernel auto-assigns an edge-aware incremental layout for nodes added in
// this batch (existing nodes are never moved). Set `autoLayoutNew: false` to
// fall back to the legacy grid slot. The editor still passes both explicitly.

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyBatch, createRuntime, getPipeline } from '../layer2/index.js'
import type { OpSpec } from '../layer1/index.js'

let scratch: string

beforeEach(() => {
  scratch = join(tmpdir(), `forgeax-autodefaults-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

function fresh() {
  const runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'plugin.test' })
  runtime.registry.register(sourceOp)
  runtime.registry.register(sinkOp)
  return runtime
}

describe('applyBatch position/edgeId auto-defaults', () => {
  it('createNode without position lands on a non-overlapping grid slot', async () => {
    const runtime = fresh()
    const res = await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'a', opId: 'kernel.source', params: { value: 1 } },
      { type: 'createNode', nodeId: 'b', opId: 'kernel.source', params: { value: 2 } },
      { type: 'createNode', nodeId: 'c', opId: 'kernel.sink', params: {} },
    ])
    expect(res.status).toBe('ok')

    const snap = getPipeline(runtime)!
    // Every node got a concrete numeric position (no undefined leaked through).
    for (const id of ['a', 'b', 'c']) {
      const pos = snap.nodes[id]!.position
      expect(typeof pos.x).toBe('number')
      expect(typeof pos.y).toBe('number')
    }
    // The three auto-positioned nodes do not all stack on the same point.
    const points = ['a', 'b', 'c'].map((id) => `${snap.nodes[id]!.position.x},${snap.nodes[id]!.position.y}`)
    expect(new Set(points).size).toBe(3)
  })

  it('explicit position is preserved verbatim', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'a', opId: 'kernel.source', position: { x: 42, y: 99 }, params: { value: 1 } },
    ])
    expect(getPipeline(runtime)!.nodes.a!.position).toEqual({ x: 42, y: 99 })
  })

  it('connect without edgeId mints a unique edge id', async () => {
    const runtime = fresh()
    const res = await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'a', opId: 'kernel.source', params: { value: 1 } },
      { type: 'createNode', nodeId: 'b', opId: 'kernel.sink', params: {} },
      { type: 'createNode', nodeId: 'c', opId: 'kernel.sink', params: {} },
      { type: 'connect', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'b', port: 'in' } },
      { type: 'connect', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'c', port: 'in' } },
    ])
    expect(res.status).toBe('ok')

    const snap = getPipeline(runtime)!
    const edgeIds = Object.keys(snap.edges)
    // Two auto-minted edges, distinct ids, both wired to the intended targets.
    expect(edgeIds.length).toBe(2)
    expect(new Set(edgeIds).size).toBe(2)
    const targets = Object.values(snap.edges).map((e) => e.target.nodeId).sort()
    expect(targets).toEqual(['b', 'c'])
  })

  it('explicit edgeId still works alongside an auto-minted one (no collision)', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'a', opId: 'kernel.source', params: { value: 1 } },
      { type: 'createNode', nodeId: 'b', opId: 'kernel.sink', params: {} },
      { type: 'createNode', nodeId: 'c', opId: 'kernel.sink', params: {} },
      { type: 'connect', edgeId: 'my_edge', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'b', port: 'in' } },
      { type: 'connect', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'c', port: 'in' } },
    ])
    const snap = getPipeline(runtime)!
    expect(snap.edges.my_edge).toBeTruthy()
    expect(Object.keys(snap.edges).length).toBe(2)
  })
})
