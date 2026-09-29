import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyBatch, createRuntime } from '../layer2/index.js'
import { writeNodeOutput } from '../layer2/write-output.js'
import type { RuntimeEvent } from '../layer2/subscriptions.js'
import {
  executeNode as executeNodeL1,
  DataTree,
  type ExecutionContext,
  type GraphNode,
  type OpSpec,
} from '../layer1/index.js'

let scratch: string

beforeEach(() => {
  scratch = join(tmpdir(), `forgeax-exec-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

function makeCtx(): ExecutionContext {
  return {
    pipelineId: 'p1',
    log: () => undefined,
    signal: new AbortController().signal,
  }
}

function fresh() {
  const runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'plugin.test' })
  runtime.registry.register(sourceOp)
  return runtime
}

function entries(v: unknown): Array<{ path: number[]; items: unknown[] }> {
  return v as Array<{ path: number[]; items: unknown[] }>
}

describe('writeNodeOutput', () => {
  it('wraps a scalar in the dispatcher wire form and tags the current graph hash', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 's', opId: 'kernel.source', position: { x: 0, y: 0 }, params: { value: 1 } },
    ])
    const graphHash = runtime.graph.load()!.hash
    const res = writeNodeOutput(runtime, 's', 'out', 7)
    expect(res).toEqual({ nodeId: 's', portId: 'out', outputType: 'number' })
    const cached = runtime.outputs.read('s', 'out')!
    expect(cached.valid).toBe(true)
    expect(cached.executedHash).toBe(graphHash)
    expect(cached.type).toBe('number')
    expect(entries(cached.data)).toEqual([{ path: [0], items: [7] }])
  })

  it('passes an already wire-shaped entries array through untouched', () => {
    const runtime = fresh()
    const wire = [{ path: [0], items: ['a', 'b'] }]
    writeNodeOutput(runtime, 'x', 'p', wire)
    expect(entries(runtime.outputs.read('x', 'p')!.data)).toEqual(wire)
  })

  it('emits exec:node:output for the written port', () => {
    const runtime = fresh()
    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('p1', ['execution'], (e) => events.push(e))
    writeNodeOutput(runtime, 'n', 'out', 'hello')
    const out = events.find((e) => e.kind === 'exec:node:output') as { nodeId: string; portId: string }
    expect(out.nodeId).toBe('n')
    expect(out.portId).toBe('out')
  })
})

describe('executeNode access semantics (Layer 1)', () => {
  it('uses op input order for the default principal regardless of edge insertion order', async () => {
    const runtime = fresh()
    runtime.registry.register({
      id: 'kernel.principal-order',
      inputs: [
        { name: 'scene', type: 'scene', access: 'item' },
        { name: 'nodes', type: 'scene', access: 'list' },
      ],
      outputs: [{ name: 'out', type: 'string', access: 'item' }],
      params: [],
      execute: (_ctx, args) => ({ out: (args.nodes as string[]).join(',') }),
    })
    const node: GraphNode = {
      id: 'principal',
      opId: 'kernel.principal-order',
      position: { x: 0, y: 0 },
      params: {},
    }

    const result = await executeNodeL1(
      runtime.registry,
      node,
      {
        nodes: [
          { path: [0, 0], items: ['A'] },
          { path: [0, 1], items: ['B'] },
        ],
        scene: [{ path: [7], items: ['Root'] }],
      },
      makeCtx(),
    )

    expect(result.error).toBeUndefined()
    expect(entries(result.outputs.out)).toEqual([{ path: [7], items: ['A,B'] }])
  })

  it('promotes a multi-item item input into one branch per item', async () => {
    const runtime = fresh()
    runtime.registry.register({
      id: 'kernel.item-access',
      inputs: [{ name: 'value', type: 'number', access: 'item' }],
      outputs: [{ name: 'out', type: 'number', access: 'item' }],
      params: [],
      execute: (_ctx, args) => ({ out: (args.value as number) * 10 }),
    })
    const node: GraphNode = {
      id: 'item',
      opId: 'kernel.item-access',
      position: { x: 0, y: 0 },
      params: {},
    }

    const result = await executeNodeL1(
      runtime.registry,
      node,
      { value: [{ path: [0], items: [1, 2] }] },
      makeCtx(),
    )

    expect(result.error).toBeUndefined()
    expect(entries(result.outputs.out)).toEqual([
      { path: [0, 0], items: [10] },
      { path: [0, 1], items: [20] },
    ])
  })

  it('dispatches DataTree wire values stored in params by item/list/tree access', async () => {
    const runtime = fresh()
    const wire = [
      { path: [0, 0], items: ['plaza'] },
      { path: [0, 1], items: ['harbor'] },
    ]
    runtime.registry.register({
      id: 'kernel.param-item',
      inputs: [{ name: 'value', type: 'string', access: 'item' }],
      outputs: [{ name: 'out', type: 'string', access: 'item' }],
      params: [],
      execute: (_ctx, args) => ({ out: `item:${String(args.value)}` }),
    })
    runtime.registry.register({
      id: 'kernel.param-list',
      inputs: [{ name: 'value', type: 'string', access: 'list' }],
      outputs: [{ name: 'out', type: 'string', access: 'item' }],
      params: [],
      execute: (_ctx, args) => ({ out: `list:${(args.value as string[]).join(',')}` }),
    })
    runtime.registry.register({
      id: 'kernel.param-tree',
      inputs: [{ name: 'value', type: 'string', access: 'tree' }],
      outputs: [{ name: 'out', type: 'number', access: 'item' }],
      params: [],
      execute: (_ctx, args) => ({
        out: (args.value as DataTree<string>).toJSON().length,
      }),
    })

    const run = (opId: string) => executeNodeL1(
      runtime.registry,
      { id: opId, opId, position: { x: 0, y: 0 }, params: { value: wire } },
      {},
      makeCtx(),
    )
    expect(entries((await run('kernel.param-item')).outputs.out)).toEqual([
      { path: [0, 0], items: ['item:plaza'] },
      { path: [0, 1], items: ['item:harbor'] },
    ])
    expect(entries((await run('kernel.param-list')).outputs.out)).toEqual([
      { path: [0], items: ['list:plaza,harbor'] },
    ])
    expect(entries((await run('kernel.param-tree')).outputs.out)).toEqual([
      { path: [0], items: [2] },
    ])
  })

  it('passes a promoted branch to list access as an ordered item array', async () => {
    const runtime = fresh()
    runtime.registry.register({
      id: 'kernel.list-access',
      inputs: [{ name: 'nodes', type: 'string', access: 'list' }],
      outputs: [{ name: 'summary', type: 'string', access: 'item' }],
      params: [],
      execute: (_ctx, args) => ({ summary: (args.nodes as string[]).join(',') }),
    })
    const node: GraphNode = {
      id: 'list',
      opId: 'kernel.list-access',
      position: { x: 0, y: 0 },
      params: {},
    }

    const result = await executeNodeL1(
      runtime.registry,
      node,
      {
        nodes: [
          { path: [0, 0], items: ['A'] },
          { path: [0, 1], items: ['B'] },
        ],
      },
      makeCtx(),
    )

    expect(result.error).toBeUndefined()
    expect(entries(result.outputs.summary)).toEqual([{ path: [0], items: ['A,B'] }])
  })

  it('serializes list access outputs as child branches for downstream list ports', async () => {
    const runtime = fresh()
    runtime.registry.register({
      id: 'kernel.list-output',
      inputs: [],
      outputs: [{ name: 'out', type: 'string', access: 'list' }],
      params: [],
      execute: () => ({ out: ['A', 'B'] }),
    })
    const node: GraphNode = {
      id: 'source',
      opId: 'kernel.list-output',
      position: { x: 0, y: 0 },
      params: {},
    }

    const result = await executeNodeL1(runtime.registry, node, {}, makeCtx())

    expect(result.error).toBeUndefined()
    expect(entries(result.outputs.out)).toEqual([
      { path: [0, 0], items: ['A'] },
      { path: [0, 1], items: ['B'] },
    ])
  })
})
