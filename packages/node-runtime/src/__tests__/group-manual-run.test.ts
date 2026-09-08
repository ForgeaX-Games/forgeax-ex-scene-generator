// Group manual-trigger run mapping — the "external Run button on a combined
// battery" feature.
//
// A combined battery (group) can pack a manual-trigger battery (e.g. image_gen).
// The collapsed group surfaces a mapped Run button; clicking it (or an AI tool
// naming the inner node id) runs the inner node through the SAME path as a
// top-level manual node: resolve inputs across the boundary, persist the result
// onto the inner node, and flow it out through the group's exposed output.
//
// This covers the kernel half:
//   1. findNodeWithGroup locates an inner node + its owning group.
//   2. resolveGroupInnerNodeInputs resolves the inner node's inputs across the
//      boundary (internal wire + exposed input + own-param fallback).
//   3. group-aware updateNode persists `_gen_image` onto the inner node.
//   4. executeGroupSubgraph HYDRATES the manual inner node from `_gen_image`,
//      so the result flows through the group's exposed output to downstream.

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  applyBatch,
  createRuntime,
  executeNode,
  findNodeWithGroup,
  getGroup,
  resolveGroupInnerNodeInputs,
} from '../layer2/index.js'
import type { OpSpec } from '../layer1/index.js'

let scratch: string

beforeEach(() => {
  scratch = join(tmpdir(), `forgeax-grun-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratch, { recursive: true })
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

const constString: OpSpec = {
  id: 'kernel.const-string',
  inputs: [],
  outputs: [{ name: 'out', type: 'string', access: 'item' }],
  params: [{ name: 'text', type: 'string' }],
  execute: (_ctx, args) => ({ out: String(args.text ?? '') }),
}
const passthrough: OpSpec = {
  id: 'kernel.passthrough',
  inputs: [{ name: 'in', type: 'string', access: 'item' }],
  outputs: [{ name: 'out', type: 'string', access: 'item' }],
  params: [],
  execute: (_ctx, args) => ({ out: args.in }),
}
// image_gen stand-in: manual-trigger, prompt + ref inputs, image + error outputs.
// If the walker ever calls execute() the test trips (fired count).
let genFired = 0
const genOp: OpSpec = {
  id: 'kernel.gen',
  inputs: [
    { name: 'prompt', type: 'string', access: 'item' },
    { name: 'ref', type: 'string', access: 'item' },
  ],
  outputs: [
    { name: 'image', type: 'image', access: 'item' },
    { name: 'error', type: 'string', access: 'item' },
  ],
  params: [],
  manualTrigger: true,
  execute: () => {
    genFired++
    return { image: 'SHOULD-NOT-RUN', error: '' }
  },
}

function fresh() {
  genFired = 0
  const runtime = createRuntime({ projectRoot: scratch, pipelineId: 'p1', pluginId: 'plugin.test' })
  runtime.registry.register(constString)
  runtime.registry.register(passthrough)
  runtime.registry.register(genOp)
  return runtime
}

// extSrc(EXT) ─┐                 panel(hi) ─┐
//              └→ gen.ref         (internal) └→ gen.prompt
//                          gen.image → sink.in
// Group {panel, gen}: ref becomes an exposed input, image an exposed output.
async function seedGroup(runtime: ReturnType<typeof fresh>) {
  await applyBatch(runtime, [
    { type: 'createNode', nodeId: 'extSrc', opId: 'kernel.const-string', position: { x: 0, y: 0 }, params: { text: 'EXT' } },
    { type: 'createNode', nodeId: 'panel', opId: 'kernel.const-string', position: { x: 0, y: 100 }, params: { text: 'hi' } },
    { type: 'createNode', nodeId: 'gen', opId: 'kernel.gen', position: { x: 100, y: 50 }, params: {} },
    { type: 'createNode', nodeId: 'sink', opId: 'kernel.passthrough', position: { x: 200, y: 50 }, params: {} },
    { type: 'connect', edgeId: 'e_pg', source: { nodeId: 'panel', port: 'out' }, target: { nodeId: 'gen', port: 'prompt' } },
    { type: 'connect', edgeId: 'e_eg', source: { nodeId: 'extSrc', port: 'out' }, target: { nodeId: 'gen', port: 'ref' } },
    { type: 'connect', edgeId: 'e_gs', source: { nodeId: 'gen', port: 'image' }, target: { nodeId: 'sink', port: 'in' } },
  ])
  await applyBatch(runtime, [
    { type: 'createGroup', groupId: 'g', name: 'Combined', memberNodeIds: ['panel', 'gen'], position: { x: 100, y: 50 } },
  ])
}

function peelItem(v: unknown): unknown {
  const entries = v as Array<{ path: number[]; items: unknown[] }> | undefined
  return entries?.[0]?.items?.[0]
}

describe('group manual-trigger run mapping', () => {
  it('findNodeWithGroup locates inner vs top-level nodes', async () => {
    const runtime = fresh()
    await seedGroup(runtime)
    expect(findNodeWithGroup(runtime, 'gen')).toMatchObject({ groupId: 'g', node: { id: 'gen' } })
    expect(findNodeWithGroup(runtime, 'panel')).toMatchObject({ groupId: 'g' })
    // Top-level: no groupId.
    const sink = findNodeWithGroup(runtime, 'sink')
    expect(sink?.node.id).toBe('sink')
    expect(sink?.groupId).toBeUndefined()
    expect(findNodeWithGroup(runtime, 'nope')).toBeNull()
  })

  it('resolveGroupInnerNodeInputs resolves internal wire + exposed input across the boundary', async () => {
    const runtime = fresh()
    await seedGroup(runtime)
    // Cache the top-level upstream feeding the group's exposed input.
    await (await executeNode(runtime, {})).done

    const inputs = await resolveGroupInnerNodeInputs(runtime, 'g', 'gen')
    expect(inputs).not.toBeNull()
    expect(peelItem(inputs!.prompt)).toBe('hi') // internal panel → gen.prompt
    expect(peelItem(inputs!.ref)).toBe('EXT') // exposed input extSrc → gen.ref
    // The manual op must never be executed during resolution.
    expect(genFired).toBe(0)
  })

  it('group-aware updateNode persists a Run result onto an inner node', async () => {
    const runtime = fresh()
    await seedGroup(runtime)
    const res = await applyBatch(runtime, [
      { type: 'updateNode', nodeId: 'gen', params: { _gen_image: 'IMG-REF', _gen_error: '' } },
    ])
    expect(res.status).toBe('ok')
    const inner = getGroup(runtime, 'g')!.nodes.find((n) => n.id === 'gen')!
    expect(inner.params._gen_image).toBe('IMG-REF')
  })

  it('hydrates the manual inner node from _gen_image and flows it to the group output + downstream', async () => {
    const runtime = fresh()
    await seedGroup(runtime)
    await applyBatch(runtime, [
      { type: 'updateNode', nodeId: 'gen', params: { _gen_image: 'IMG-REF', _gen_error: '' } },
    ])

    const outPortName = getGroup(runtime, 'g')!.exposedOutputs.find(
      (p) => p.sourceNodeId === 'gen' && p.sourcePortName === 'image',
    )!.portName

    const result = await (await executeNode(runtime, {})).done
    expect(result.status).toBe('completed')
    // The manual op is hydrated as a boundary, never executed.
    expect(genFired).toBe(0)
    // Group exposed output (bound to gen.image) carries the persisted Run result...
    expect(peelItem(result.outputs.g![outPortName])).toBe('IMG-REF')
    // ...and the downstream top-level consumer received it.
    expect(peelItem(result.outputs.sink!.out)).toBe('IMG-REF')
  })

  it('with no persisted result the inner manual node contributes nothing', async () => {
    const runtime = fresh()
    await seedGroup(runtime)
    const result = await (await executeNode(runtime, {})).done
    expect(result.status).toBe('completed')
    expect(genFired).toBe(0)
    expect(result.outputs.g?.image).toBeUndefined()
  })
})
