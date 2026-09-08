// Layer 2 applyBatch output-cache invalidation.
//
// Deleting an input edge (or a node / group) changes what a target node — and
// everything downstream of it — resolves for its inputs. The persisted outputs/
// cache for that subtree is therefore stale and must be invalidated, otherwise
// the next execute re-hydrates old values. This is most visible for
// manualTrigger ops: the executor skips re-running them and reads their cached
// output straight back, so without invalidation "删除输入边后输出没变".

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyBatch, createRuntime } from '../layer2/index.js'
import { executeNode } from '../layer2/execute-node.js'
import { writeNodeOutput } from '../layer2/write-output.js'
import type { OpSpec } from '../layer1/index.js'

let scratch: string

beforeEach(() => {
  scratch = join(tmpdir(), `forgeax-applyinv-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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
// `in` falls back to its declared default (10) when the incoming edge is gone.
const doubleOp: OpSpec = {
  id: 'kernel.double',
  inputs: [{ name: 'in', type: 'number', access: 'item', default: 10 }],
  outputs: [{ name: 'out', type: 'number', access: 'item' }],
  params: [],
  execute: (_ctx, args) => ({ out: (args.in as number) * 2 }),
}
// A manual-trigger op: the walker never auto-runs it, it only hydrates whatever
// is in the output cache (mirrors the AI ImageGen/TextGen batteries).
const aiOp: OpSpec = {
  id: 'kernel.ai',
  inputs: [{ name: 'prompt', type: 'string', access: 'item', default: '' }],
  outputs: [{ name: 'image', type: 'image', access: 'item' }],
  params: [],
  manualTrigger: true,
  execute: () => ({ image: 'SHOULD_NOT_RUN' }),
}

function fresh() {
  const runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'plugin.test' })
  runtime.registry.register(sourceOp)
  runtime.registry.register(doubleOp)
  runtime.registry.register(aiOp)
  return runtime
}

// s(value:21) -> d(double)
async function seedChain(runtime: ReturnType<typeof fresh>) {
  await applyBatch(runtime, [
    { type: 'createNode', nodeId: 's', opId: 'kernel.source', position: { x: 0, y: 0 }, params: { value: 21 } },
    { type: 'createNode', nodeId: 'd', opId: 'kernel.double', position: { x: 100, y: 0 }, params: {} },
    { type: 'connect', edgeId: 'e1', source: { nodeId: 's', port: 'out' }, target: { nodeId: 'd', port: 'in' } },
  ])
}

describe('applyBatch output-cache invalidation', () => {
  it('invalidates the target node cache when its input edge is disconnected', async () => {
    const runtime = fresh()
    await seedChain(runtime)
    await (await executeNode(runtime, { nodeId: 's' })).done
    // Cache is primed: d doubled 21 -> 42.
    expect(runtime.outputs.read('d', 'out')).not.toBeNull()

    const res = await applyBatch(runtime, [{ type: 'disconnect', edgeId: 'e1' }])
    expect(res.status).toBe('ok')
    // d's cache (the disconnect target) is gone.
    expect(runtime.outputs.read('d', 'out')).toBeNull()
  })

  it('invalidates the whole downstream closure when an edge is deleted', async () => {
    const runtime = fresh()
    // s -> d1 -> d2 (chain). Deleting s->d1 must invalidate d1 AND d2.
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 's', opId: 'kernel.source', position: { x: 0, y: 0 }, params: { value: 5 } },
      { type: 'createNode', nodeId: 'd1', opId: 'kernel.double', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'd2', opId: 'kernel.double', position: { x: 200, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 's', port: 'out' }, target: { nodeId: 'd1', port: 'in' } },
      { type: 'connect', edgeId: 'e2', source: { nodeId: 'd1', port: 'out' }, target: { nodeId: 'd2', port: 'in' } },
    ])
    await (await executeNode(runtime, { nodeId: 's' })).done
    expect(runtime.outputs.read('d1', 'out')).not.toBeNull()
    expect(runtime.outputs.read('d2', 'out')).not.toBeNull()

    await applyBatch(runtime, [{ type: 'disconnect', edgeId: 'e1' }])

    expect(runtime.outputs.read('d1', 'out')).toBeNull()
    expect(runtime.outputs.read('d2', 'out')).toBeNull()
  })

  it('re-executing after disconnect falls back to the input default (output changes)', async () => {
    const runtime = fresh()
    await seedChain(runtime)
    await (await executeNode(runtime, { nodeId: 's' })).done
    // 21 -> 42 cached.
    expect((runtime.outputs.read('d', 'out')!.data as Array<{ items: number[] }>)[0]!.items).toEqual([42])

    await applyBatch(runtime, [{ type: 'disconnect', edgeId: 'e1' }])
    // Run d's own closure: no incoming edge => `in` falls back to default 10 => 20.
    const result = await (await executeNode(runtime, { nodeId: 'd' })).done
    expect(result.status).toBe('completed')
    expect((runtime.outputs.read('d', 'out')!.data as Array<{ items: number[] }>)[0]!.items).toEqual([20])
  })

  it('manualTrigger node: disconnecting its input edge clears the stale cached output', async () => {
    const runtime = fresh()
    // s(value) -> ai(manualTrigger). The Run button wrote ai.image out-of-band.
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 's', opId: 'kernel.source', position: { x: 0, y: 0 }, params: { value: 1 } },
      { type: 'createNode', nodeId: 'ai', opId: 'kernel.ai', position: { x: 100, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 's', port: 'out' }, target: { nodeId: 'ai', port: 'prompt' } },
    ])
    writeNodeOutput(runtime, 'ai', 'image', 'GENERATED_IMAGE')
    expect(runtime.outputs.read('ai', 'image')?.data).toBeDefined()

    // Delete the input edge. ai's cache must be dropped — not hydrated as stale.
    await applyBatch(runtime, [{ type: 'disconnect', edgeId: 'e1' }])
    expect(runtime.outputs.read('ai', 'image')).toBeNull()

    // A subsequent execute does NOT re-run the manualTrigger op (execute returns
    // the sentinel only if it ran), and produces no output for it (empty cache).
    const result = await (await executeNode(runtime, { nodeId: 'ai' })).done
    expect(result.status).toBe('completed')
    expect(result.outputs.ai).toEqual({})
    expect(runtime.outputs.read('ai', 'image')).toBeNull()
  })

  it('deleting a node invalidates its surviving downstream caches', async () => {
    const runtime = fresh()
    await seedChain(runtime)
    await (await executeNode(runtime, { nodeId: 's' })).done
    expect(runtime.outputs.read('d', 'out')).not.toBeNull()

    // Delete s (cascade-removes e1). d is surviving downstream => its cache stale.
    await applyBatch(runtime, [{ type: 'deleteNode', nodeId: 's' }])
    expect(runtime.outputs.read('s', 'out')).toBeNull()
    expect(runtime.outputs.read('d', 'out')).toBeNull()
  })

  it('does not invalidate caches for an unrelated subtree', async () => {
    const runtime = fresh()
    // Two independent chains: s1->d1 (edge e1) and s2->d2 (edge e2).
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 's1', opId: 'kernel.source', position: { x: 0, y: 0 }, params: { value: 3 } },
      { type: 'createNode', nodeId: 'd1', opId: 'kernel.double', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 's2', opId: 'kernel.source', position: { x: 0, y: 100 }, params: { value: 7 } },
      { type: 'createNode', nodeId: 'd2', opId: 'kernel.double', position: { x: 100, y: 100 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 's1', port: 'out' }, target: { nodeId: 'd1', port: 'in' } },
      { type: 'connect', edgeId: 'e2', source: { nodeId: 's2', port: 'out' }, target: { nodeId: 'd2', port: 'in' } },
    ])
    await (await executeNode(runtime, {})).done
    expect(runtime.outputs.read('d1', 'out')).not.toBeNull()
    expect(runtime.outputs.read('d2', 'out')).not.toBeNull()

    // Disconnect only chain 1. Chain 2's cache must survive untouched.
    await applyBatch(runtime, [{ type: 'disconnect', edgeId: 'e1' }])
    expect(runtime.outputs.read('d1', 'out')).toBeNull()
    expect(runtime.outputs.read('d2', 'out')).not.toBeNull()
  })

  it('updateNode param change invalidates the edited node and its downstream closure', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 's', opId: 'kernel.source', position: { x: 0, y: 0 }, params: { value: 5 } },
      { type: 'createNode', nodeId: 'd1', opId: 'kernel.double', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'd2', opId: 'kernel.double', position: { x: 200, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 's', port: 'out' }, target: { nodeId: 'd1', port: 'in' } },
      { type: 'connect', edgeId: 'e2', source: { nodeId: 'd1', port: 'out' }, target: { nodeId: 'd2', port: 'in' } },
    ])
    await (await executeNode(runtime, { nodeId: 's' })).done
    expect(runtime.outputs.read('d2', 'out')).not.toBeNull()

    await applyBatch(runtime, [{ type: 'updateNode', nodeId: 's', params: { value: 9 } }])
    expect(runtime.outputs.read('s', 'out')).toBeNull()
    expect(runtime.outputs.read('d1', 'out')).toBeNull()
    expect(runtime.outputs.read('d2', 'out')).toBeNull()
  })

  it('deleteGroup removes inner member output caches (not just the group shadow)', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'a', opId: 'kernel.source', position: { x: 0, y: 0 }, params: { value: 1 } },
      { type: 'createNode', nodeId: 'b', opId: 'kernel.double', position: { x: 100, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e_ab', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'b', port: 'in' } },
      { type: 'createGroup', groupId: 'g1', name: 'Pair', memberNodeIds: ['a', 'b'], position: { x: 0, y: 0 } },
    ])
    // Simulate prior execution: inner nodes still own outputs/<id>/ dirs.
    writeNodeOutput(runtime, 'a', 'out', 1)
    writeNodeOutput(runtime, 'b', 'out', 2)
    expect(runtime.outputs.read('a', 'out')).not.toBeNull()
    expect(runtime.outputs.read('b', 'out')).not.toBeNull()

    await applyBatch(runtime, [{ type: 'deleteGroup', groupId: 'g1' }])

    expect(runtime.outputs.read('g1', 'out_0')).toBeNull()
    expect(runtime.outputs.read('a', 'out')).toBeNull()
    expect(runtime.outputs.read('b', 'out')).toBeNull()
  })
})
