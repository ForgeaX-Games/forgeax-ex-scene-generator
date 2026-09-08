import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyBatch, createRuntime } from '../layer2/index.js'
import { executeNode } from '../layer2/execute-node.js'
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
const doubleOp: OpSpec = {
  id: 'kernel.double',
  inputs: [{ name: 'in', type: 'number', access: 'item' }],
  outputs: [{ name: 'out', type: 'number', access: 'item' }],
  params: [],
  execute: (_ctx, args) => ({ out: (args.in as number) * 2 }),
}
const boomOp: OpSpec = {
  id: 'kernel.boom',
  inputs: [],
  outputs: [{ name: 'out', type: 'number', access: 'item' }],
  params: [],
  execute: () => {
    throw new Error('kaboom')
  },
}

// Mirrors processImage-style batteries: declares an `error` output port and
// returns error:'' on success. The dispatcher must NOT treat '' as a failure
// (which would discard `image`), and a non-empty error must still abort.
const ioOp: OpSpec = {
  id: 'kernel.io',
  inputs: [{ name: 'in', type: 'image', access: 'item' }],
  outputs: [
    { name: 'image', type: 'image', access: 'item' },
    { name: 'error', type: 'string', access: 'item' },
  ],
  params: [{ name: 'fail', type: 'boolean' }],
  execute: (_ctx, args) =>
    args.fail
      ? { image: '', error: 'boom message' }
      : { image: `out:${String(args.in)}`, error: '' },
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
  runtime.registry.register(doubleOp)
  runtime.registry.register(boomOp)
  runtime.registry.register(ioOp)
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

function entries(v: unknown): Array<{ path: number[]; items: unknown[] }> {
  return v as Array<{ path: number[]; items: unknown[] }>
}

describe('executeNode (Layer 2)', () => {
  it('target mode runs the downstream closure (the node + descendants) and threads values', async () => {
    const runtime = fresh()
    await seedChain(runtime)
    const handle = await executeNode(runtime, { nodeId: 's' })
    const result = await handle.done
    expect(result.status).toBe('completed')
    expect(entries(result.outputs.d!.out)[0]!.items).toEqual([42])
    expect(result.outputs.s).toBeDefined()
    expect(result.resultMetadata?.d?.out).toEqual({
      producerNodeId: 'd',
      producerPort: 'out',
      outputType: 'number',
      value: { inline: true },
    })
  })

  it('op returning error:"" (success sentinel) still publishes its outputs', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'io', opId: 'kernel.io', position: { x: 0, y: 0 }, params: { in: 'src.png' } },
    ])
    const result = await (await executeNode(runtime, { nodeId: 'io' })).done
    expect(result.status).toBe('completed')
    expect(result.error).toBeUndefined()
    expect(entries(result.outputs.io!.image)[0]!.items).toEqual(['out:src.png'])
    expect(entries(result.outputs.io!.error)[0]!.items).toEqual([''])
    // The output cache must hold the image so a port tooltip / downstream read
    // resolves a value instead of "no result".
    expect(runtime.outputs.read('io', 'image')?.data).toBeDefined()
  })

  it('op returning a non-empty error aborts the node (no outputs published)', async () => {
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'io', opId: 'kernel.io', position: { x: 0, y: 0 }, params: { in: 'src.png', fail: true } },
    ])
    const result = await (await executeNode(runtime, { nodeId: 'io' })).done
    expect(result.status).toBe('error')
    expect(result.error?.message).toContain('boom message')
  })

  it('partial re-run of a sink hydrates boundary upstream inputs from the cache (no re-run of upstream)', async () => {
    const runtime = fresh()
    await seedChain(runtime)
    // Prime the output cache with a full run, then re-run only the sink `d`.
    await (await executeNode(runtime, {})).done
    const result = await (await executeNode(runtime, { nodeId: 'd' })).done
    expect(result.status).toBe('completed')
    // Only `d` ran this pass; `s` came from the cache, not re-executed.
    expect(Object.keys(result.outputs)).toEqual(['d'])
    expect(entries(result.outputs.d!.out)[0]!.items).toEqual([42])
  })

  it('partial re-run re-executes boundary upstream nodes when their cache was pruned', async () => {
    const runtime = fresh()
    await seedChain(runtime)
    await (await executeNode(runtime, {})).done
    // Simulate retention pruning the upstream const node while leaving the sink cache.
    runtime.outputs.invalidate('s')
    const result = await (await executeNode(runtime, { nodeId: 'd' })).done
    expect(result.status).toBe('completed')
    expect(Object.keys(result.outputs).sort()).toEqual(['d', 's'])
    expect(entries(result.outputs.d!.out)[0]!.items).toEqual([42])
  })

  it('a partial run does not abort on an unrelated, un-included upstream error', async () => {
    const runtime = fresh()
    // good: s -> d   and a separate broken sink fed by boom: boom -> bd
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 's', opId: 'kernel.source', position: { x: 0, y: 0 }, params: { value: 21 } },
      { type: 'createNode', nodeId: 'd', opId: 'kernel.double', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'boom', opId: 'kernel.boom', position: { x: 0, y: 50 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 's', port: 'out' }, target: { nodeId: 'd', port: 'in' } },
    ])
    // Prime the good chain's cache (downstream of `s` = {s, d}; never touches boom).
    await (await executeNode(runtime, { nodeId: 's' })).done
    // Re-running only `d`'s downstream closure must not touch `boom`.
    const result = await (await executeNode(runtime, { nodeId: 'd' })).done
    expect(result.status).toBe('completed')
    expect(entries(result.outputs.d!.out)[0]!.items).toEqual([42])
  })

  it('pipeline mode runs every node', async () => {
    const runtime = fresh()
    await seedChain(runtime)
    const result = await (await executeNode(runtime, {})).done
    expect(result.status).toBe('completed')
    expect(Object.keys(result.outputs).sort()).toEqual(['d', 's'])
  })

  it('emits started, per-port outputs, then completed in order', async () => {
    const runtime = fresh()
    await seedChain(runtime)
    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('p1', ['execution'], (e) => events.push(e))
    await (await executeNode(runtime, { nodeId: 's' })).done
    expect(events.map((e) => e.kind)).toEqual([
      'exec:started',
      'exec:node:output',
      'exec:node:output',
      'exec:completed',
    ])
    const outputs = events.filter((e) => e.kind === 'exec:node:output')
    expect(outputs.map((e) => (e as { nodeId: string }).nodeId)).toEqual(['s', 'd'])
  })

  it('writes produced outputs to the output cache', async () => {
    const runtime = fresh()
    await seedChain(runtime)
    await (await executeNode(runtime, { nodeId: 's' })).done
    const cached = runtime.outputs.read('d', 'out')
    expect(cached).not.toBeNull()
    expect(cached!.type).toBe('number')
  })

  it('lets hosts enrich the execution context with plugin services', async () => {
    const runtime = createRuntime({
      projectRoot: scratch,
      pipelineId: 'p1',
      pluginId: 'plugin.test',
      createExecutionContext: (base) => ({
        ...base,
        services: { baker: { tag: 'shared-service' } },
      }),
    })
    runtime.registry.register({
      id: 'kernel.ctx',
      inputs: [],
      outputs: [{ name: 'out', type: 'string', access: 'item' }],
      params: [],
      execute: (ctx) => ({ out: (ctx.services?.baker as { tag: string }).tag }),
    })
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'ctx', opId: 'kernel.ctx', position: { x: 0, y: 0 }, params: {} },
    ])

    const result = await (await executeNode(runtime, {})).done

    expect(result.status).toBe('completed')
    expect(entries(result.outputs.ctx!.out)[0]!.items).toEqual(['shared-service'])
  })

  it('passes a __relay__ node input through to its output', async () => {
    const runtime = fresh()
    // s(7) -> r(__relay__) -> d(double); relay forwards input on its 'input' port
    // to its 'output' port unchanged.
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 's', opId: 'kernel.source', position: { x: 0, y: 0 }, params: { value: 7 } },
      { type: 'createNode', nodeId: 'r', opId: '__relay__', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'd', opId: 'kernel.double', position: { x: 200, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 's', port: 'out' }, target: { nodeId: 'r', port: 'input' } },
      { type: 'connect', edgeId: 'e2', source: { nodeId: 'r', port: 'output' }, target: { nodeId: 'd', port: 'in' } },
    ])
    const result = await (await executeNode(runtime, {})).done
    expect(result.status).toBe('completed')
    // 7 forwarded through the relay unchanged, then doubled by d.
    expect(entries(result.outputs.r!.output)[0]!.items).toEqual([7])
    expect(entries(result.outputs.d!.out)[0]!.items).toEqual([14])
  })

  // Semantics reversed on purpose (was: "…and stops, no completed"). Aborting the
  // whole walk on the first failure meant one half-wired node blanked every node
  // after it in topological order — their caches were never written, so their
  // ports read "-" until something unrelated re-ran them.
  it('emits exec:error with the failing nodeId but keeps walking the rest of the graph', async () => {
    const runtime = fresh()
    await seedChain(runtime)
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'boom', opId: 'kernel.boom', position: { x: 0, y: 0 }, params: {} },
    ])
    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('p1', ['execution'], (e) => events.push(e))
    const result = await (await executeNode(runtime, {})).done

    expect(result.status).toBe('error')
    expect(result.error?.nodeId).toBe('boom')
    expect(result.failures).toEqual([
      expect.objectContaining({ nodeId: 'boom' }),
    ])
    const err = events.find((e) => e.kind === 'exec:error') as { nodeId?: string; message: string }
    expect(err.nodeId).toBe('boom')
    // The unrelated chain still computed AND persisted, and the renderer still
    // gets its refresh signal.
    expect(entries(result.outputs.d!.out)[0]!.items).toEqual([42])
    expect(runtime.outputs.read('d', 'out')?.data).toBeDefined()
    expect(events.some((e) => e.kind === 'exec:completed')).toBe(true)
  })

  it('abort stops the walk and resolves with status aborted', async () => {
    const runtime = fresh()
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    runtime.registry.register({
      id: 'kernel.gated',
      inputs: [],
      outputs: [{ name: 'out', type: 'number', access: 'item' }],
      params: [],
      execute: async () => {
        await gate
        return { out: 1 }
      },
    })
    // g(gated) -> d(double)
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'g', opId: 'kernel.gated', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'd', opId: 'kernel.double', position: { x: 100, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 'g', port: 'out' }, target: { nodeId: 'd', port: 'in' } },
    ])
    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('p1', ['execution'], (e) => events.push(e))
    const handle = await executeNode(runtime, {})
    handle.abort()
    release()
    const result = await handle.done
    expect(result.status).toBe('aborted')
    // Abort stops at the next node boundary: the in-flight node 'g' completes,
    // but its downstream 'd' never runs.
    expect(result.outputs.g).toBeDefined()
    expect(result.outputs.d).toBeUndefined()
    const err = events.find((e) => e.kind === 'exec:error') as { message: string }
    expect(err.message).toBe('aborted')
    expect(events.some((e) => e.kind === 'exec:completed')).toBe(false)
  })

  it('returns a structured error result for an unknown target node', async () => {
    const runtime = fresh()
    await seedChain(runtime)
    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('p1', ['execution'], (e) => events.push(e))
    // A missing target is a client/timing error (e.g. a drop-then-execute race
    // where the node's create batch has not committed yet). It resolves as a
    // structured error result rather than rejecting — a reject becomes a bare
    // HTTP 500 at the backend seam.
    const handle = await executeNode(runtime, { nodeId: 'nope' })
    const result = await handle.done
    expect(result.status).toBe('error')
    expect(result.error?.message).toMatch(/not found/)
    expect(result.error?.nodeId).toBe('nope')
    expect(events.some((e) => e.kind === 'exec:error')).toBe(true)
    expect(events.some((e) => e.kind === 'exec:completed')).toBe(false)
  })

  it('returns a structured error result for a cyclic graph', async () => {
    const runtime = fresh()
    const now = new Date().toISOString()
    const mk = (id: string) => ({ id, opId: 'kernel.double', position: { x: 0, y: 0 }, params: {} })
    runtime.graph.save({
      schemaVersion: 1,
      id: 'p1',
      createdAt: now,
      updatedAt: now,
      nodes: { a: mk('a'), b: mk('b') },
      edges: {
        e1: { id: 'e1', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'b', port: 'in' } },
        e2: { id: 'e2', source: { nodeId: 'b', port: 'out' }, target: { nodeId: 'a', port: 'in' } },
      },
    })
    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('p1', ['execution'], (e) => events.push(e))
    const handle = await executeNode(runtime, {})
    const result = await handle.done
    expect(result.status).toBe('error')
    expect(result.error?.message).toMatch(/cycle/)
    expect(events.some((e) => e.kind === 'exec:error')).toBe(true)
    expect(events.some((e) => e.kind === 'exec:completed')).toBe(false)
  })
})

describe('executeNode — manualTrigger ops', () => {
  // A manual-trigger source: the walker must NEVER call execute(); if it does the
  // spy below trips. Its output is produced out-of-band via writeNodeOutput.
  function freshManual() {
    const runtime = fresh()
    let fired = 0
    const manualSource: OpSpec = {
      id: 'kernel.manual-source',
      inputs: [{ name: 'trigger', type: 'string', access: 'item' }],
      outputs: [{ name: 'out', type: 'number', access: 'item' }],
      params: [],
      manualTrigger: true,
      execute: () => {
        fired++
        return { out: -1 }
      },
    }
    runtime.registry.register(manualSource)
    return { runtime, firedCount: () => fired }
  }

  it('skips a manual-trigger node in the walk and emits exec:node:skipped', async () => {
    const { runtime, firedCount } = freshManual()
    // src(value) -> m(manual) -> d(double). m is the manual-trigger op.
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'src', opId: 'kernel.source', position: { x: 0, y: 0 }, params: { value: 5 } },
      { type: 'createNode', nodeId: 'm', opId: 'kernel.manual-source', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'd', opId: 'kernel.double', position: { x: 200, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'm', port: 'trigger' } },
      { type: 'connect', edgeId: 'e2', source: { nodeId: 'm', port: 'out' }, target: { nodeId: 'd', port: 'in' } },
    ])
    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('p1', ['execution'], (e) => events.push(e))

    const result = await (await executeNode(runtime, {})).done

    expect(result.status).toBe('completed')
    // execute() of the manual op was never called by the walker.
    expect(firedCount()).toBe(0)
    const skipped = events.find((e) => e.kind === 'exec:node:skipped') as { nodeId: string; reason: string }
    expect(skipped.nodeId).toBe('m')
    expect(skipped.reason).toBe('manualTrigger')
  })

  it('hydrates a downstream consumer from the manual op cached output (out-of-band)', async () => {
    const { runtime, firedCount } = freshManual()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'm', opId: 'kernel.manual-source', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'd', opId: 'kernel.double', position: { x: 100, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 'm', port: 'out' }, target: { nodeId: 'd', port: 'in' } },
    ])
    // The "Run button" path writes the manual op's output to the cache directly.
    writeNodeOutput(runtime, 'm', 'out', 21)

    const result = await (await executeNode(runtime, {})).done

    expect(result.status).toBe('completed')
    expect(firedCount()).toBe(0)
    // d consumed the cached 21 (wire-wrapped by writeNodeOutput) and doubled it.
    expect(entries(result.outputs.d!.out)[0]!.items).toEqual([42])
  })
})

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
    // Wire form: a single item-access branch.
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

describe('executeNode connection metadata inference (Layer 2)', () => {
  it('derives missing inferredAccess for adaptive dynamic tree inputs from the first source port', async () => {
    const runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'plugin.test' })
    runtime.registry.register({
      id: 'kernel.item-source',
      inputs: [],
      outputs: [{ name: 'out', type: 'scene', access: 'item' }],
      params: [{ name: 'value', type: 'string' }],
      execute: (_ctx, args) => ({ out: args.value }),
    })
    runtime.registry.register({
      id: 'kernel.adaptive-merge',
      inputs: [
        { name: 'item_0', type: 'any', access: 'tree' },
        { name: 'item_1', type: 'any', access: 'tree' },
      ],
      outputs: [{ name: 'tree', type: 'any', access: 'tree' }],
      params: [],
      dynamicInputs: { prefix: 'item_', labelTemplate: '[$i]', minCount: 2, type: 'any', access: 'tree' },
      execute: (_ctx, args) => {
        const a = args.item_0 as { toJSON(): Array<{ path: number[]; items: string[] }> }
        const b = args.item_1 as { toJSON(): Array<{ path: number[]; items: string[] }> }
        const aEntries = a.toJSON()
        const bEntries = b.toJSON()
        if (args.inferredAccess === 'item') {
          return { tree: DataTree.fromEntries([{ path: [0], items: [aEntries[0]!.items[0], bEntries[0]!.items[0]] }]) }
        }
        return {
          tree: DataTree.fromEntries([
            { path: [0, 0], items: [aEntries[0]!.items[0]] },
            { path: [1, 0], items: [bEntries[0]!.items[0]] },
          ]),
        }
      },
    })

    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'a', opId: 'kernel.item-source', position: { x: 0, y: 0 }, params: { value: 'A' } },
      { type: 'createNode', nodeId: 'b', opId: 'kernel.item-source', position: { x: 0, y: 0 }, params: { value: 'B' } },
      { type: 'createNode', nodeId: 'merge', opId: 'kernel.adaptive-merge', position: { x: 0, y: 0 }, params: { portCount: 2 } },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'merge', port: 'item_0' } },
      { type: 'connect', edgeId: 'e2', source: { nodeId: 'b', port: 'out' }, target: { nodeId: 'merge', port: 'item_1' } },
    ])

    // Prime the cache so the partial re-run of the merge sink can hydrate a/b.
    await (await executeNode(runtime, {})).done
    const result = await (await executeNode(runtime, { nodeId: 'merge' })).done

    expect(result.status).toBe('completed')
    expect(entries(result.outputs.merge!.tree)).toEqual([{ path: [0], items: ['A', 'B'] }])
  })

  it('does not crash on a node persisted without a params field (params undefined)', async () => {
    // Backend applyBatch/import and hand-built graphs can persist a node with NO
    // `params` key at all (params === undefined), unlike the editor which always
    // writes `params: {}`. The connection-inference probe must not dereference
    // `node.params.inferredAccess` blindly — doing so threw
    // "Cannot read properties of undefined (reading 'inferredAccess')" and
    // aborted the whole pipeline at the first such node.
    const runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'plugin.test' })
    runtime.registry.register({
      id: 'kernel.item-source',
      inputs: [],
      outputs: [{ name: 'out', type: 'scene', access: 'item' }],
      params: [{ name: 'value', type: 'string' }],
      execute: (_ctx, args) => ({ out: args.value }),
    })
    runtime.registry.register({
      id: 'kernel.adaptive-merge',
      inputs: [
        { name: 'item_0', type: 'any', access: 'tree' },
        { name: 'item_1', type: 'any', access: 'tree' },
      ],
      outputs: [{ name: 'tree', type: 'any', access: 'tree' }],
      params: [],
      dynamicInputs: { prefix: 'item_', labelTemplate: '[$i]', minCount: 2, type: 'any', access: 'tree' },
      execute: (_ctx, args) => {
        const a = args.item_0 as { toJSON(): Array<{ path: number[]; items: string[] }> }
        const b = args.item_1 as { toJSON(): Array<{ path: number[]; items: string[] }> }
        const aEntries = a.toJSON()
        const bEntries = b.toJSON()
        if (args.inferredAccess === 'item') {
          return { tree: DataTree.fromEntries([{ path: [0], items: [aEntries[0]!.items[0], bEntries[0]!.items[0]] }]) }
        }
        return {
          tree: DataTree.fromEntries([
            { path: [0, 0], items: [aEntries[0]!.items[0]] },
            { path: [1, 0], items: [bEntries[0]!.items[0]] },
          ]),
        }
      },
    })

    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'a', opId: 'kernel.item-source', position: { x: 0, y: 0 }, params: { value: 'A' } },
      { type: 'createNode', nodeId: 'b', opId: 'kernel.item-source', position: { x: 0, y: 0 }, params: { value: 'B' } },
      { type: 'createNode', nodeId: 'merge', opId: 'kernel.adaptive-merge', position: { x: 0, y: 0 }, params: { portCount: 2 } },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'merge', port: 'item_0' } },
      { type: 'connect', edgeId: 'e2', source: { nodeId: 'b', port: 'out' }, target: { nodeId: 'merge', port: 'item_1' } },
    ])

    // Simulate a backend-built / imported graph: strip the `params` key off the
    // merge node entirely so it is persisted as `undefined` (the real crashing
    // graph had several such nodes, e.g. seed_control / tree_flatten / __group__).
    const graphFile = runtime.graph.load()!
    delete (graphFile.nodes.merge as { params?: unknown }).params
    runtime.graph.save({ ...graphFile, hash: undefined as unknown as string })

    const result = await (await executeNode(runtime, {})).done

    expect(result.error).toBeUndefined()
    expect(result.status).toBe('completed')
    // params is undefined → no locked inferredAccess to shadow → the engine still
    // derives access from the first dynamic input's source port (item) and the
    // merge does an item-level concat, exactly like the frontend connect-hook.
    expect(entries(result.outputs.merge!.tree)).toEqual([{ path: [0], items: ['A', 'B'] }])
  })
})

describe('executeNode group sub-graph', () => {
  it('runs a __group__ node and threads values through it', async () => {
    const runtime = fresh()
    // s(5) -> m(double) -> k(double); then wrap {m} into a group.
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 's', opId: 'kernel.source', position: { x: 0, y: 0 }, params: { value: 5 } },
      { type: 'createNode', nodeId: 'm', opId: 'kernel.double', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'k', opId: 'kernel.double', position: { x: 200, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 's', port: 'out' }, target: { nodeId: 'm', port: 'in' } },
      { type: 'connect', edgeId: 'e2', source: { nodeId: 'm', port: 'out' }, target: { nodeId: 'k', port: 'in' } },
    ])
    await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g', name: 'Inner', memberNodeIds: ['m'], position: { x: 100, y: 0 } },
    ])

    const events: RuntimeEvent[] = []
    runtime.subscriptions.subscribe('p1', ['execution'], (e) => events.push(e))
    const result = await (await executeNode(runtime, {})).done

    expect(result.status).toBe('completed')
    // s=5 -> group(m doubles -> 10) -> k doubles -> 20
    expect(entries(result.outputs.k!.out)[0]!.items).toEqual([20])
    // the group node emitted at least one output event
    expect(
      events.some((e) => e.kind === 'exec:node:output' && (e as { nodeId: string }).nodeId === 'g'),
    ).toBe(true)
  })

  it('group the middle node with a frontend-style contract: output carries value + real type', async () => {
    // Mirrors the user scenario: an ALREADY-wired battery (s -> m -> k) is
    // grouped. The frontend hands a createGroup contract binding stable ports
    // in_0/out_0 to m.in / m.out. The group must (a) expose out_0 typed from the
    // inner op (NOT 'any'), and (b) thread m's value to out_0 so the external
    // slot is not "no result".
    const runtime = fresh()
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 's', opId: 'kernel.source', position: { x: 0, y: 0 }, params: { value: 5 } },
      { type: 'createNode', nodeId: 'm', opId: 'kernel.double', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'k', opId: 'kernel.double', position: { x: 200, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 's', port: 'out' }, target: { nodeId: 'm', port: 'in' } },
      { type: 'connect', edgeId: 'e2', source: { nodeId: 'm', port: 'out' }, target: { nodeId: 'k', port: 'in' } },
    ])
    await applyBatch(runtime, [
      {
        type: 'createGroup', groupId: 'g', name: 'Inner', memberNodeIds: ['m'], position: { x: 100, y: 0 },
        exposedPorts: {
          inputs: [{ portName: 'in_0', access: 'tree', sourceNodeId: 'm', sourcePortName: 'in' }],
          outputs: [{ portName: 'out_0', sourceNodeId: 'm', sourcePortName: 'out' }],
        },
      },
    ])

    const graph = runtime.graph.load()!
    const grp = graph.groups!.g!
    expect(grp.exposedInputs[0]?.access).toBe('tree')
    // Exposed output must keep the stable name, map to m.out, and carry the inner
    // op's real type (number) — never collapse to 'any'.
    expect(grp.exposedOutputs).toEqual([
      { portName: 'out_0', portType: 'number', access: 'item', sourceNodeId: 'm', sourcePortName: 'out' },
    ])

    const result = await (await executeNode(runtime, {})).done
    expect(result.status).toBe('completed')
    // s=5 -> group(m doubles -> 10): the group's external out_0 slot must be 10.
    expect(entries(result.outputs.g!.out_0)[0]!.items).toEqual([10])
    // and the downstream k doubles 10 -> 20.
    expect(entries(result.outputs.k!.out)[0]!.items).toEqual([20])
    // The output cache (what drives the data-probe type badge) must carry the
    // group's REAL exposed port type — derived from exposedOutputs, NOT the
    // generic '__group__' op spec (which would collapse to 'any').
    const cachedGroupOut = runtime.outputs.read('g', 'out_0')
    expect(cachedGroupOut).not.toBeNull()
    expect(cachedGroupOut!.type).toBe('number')
  })

  it('invalidates cached output when implementationRevision changes', async () => {
    const runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'plugin.test' })
    runtime.registry.register({
      id: 'kernel.echo-rev',
      inputs: [],
      outputs: [{ name: 'value', type: 'number', access: 'item' }],
      params: [],
      implementationRevision: 'rev-1',
      execute: () => ({ value: 1 }),
    })
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'n1', opId: 'kernel.echo-rev', position: { x: 0, y: 0 }, params: {} },
    ])
    const first = await (await executeNode(runtime, { nodeId: 'n1' })).done
    expect(first.status).toBe('completed')
    expect(runtime.outputs.readMeta('n1', 'value')?.opRevision).toBe('rev-1')
    runtime.registry.replace({
      id: 'kernel.echo-rev',
      inputs: [],
      outputs: [{ name: 'value', type: 'number', access: 'item' }],
      params: [],
      implementationRevision: 'rev-2',
      execute: () => ({ value: 2 }),
    })
    const second = await (await executeNode(runtime, { nodeId: 'n1' })).done
    expect(second.status).toBe('completed')
    expect(entries(second.outputs.n1!.value)[0]!.items).toEqual([2])
  })
})
