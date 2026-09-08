// Layer 2 nested group execution — a group whose member is itself a group.
//
// layer1's executeGroupSubgraph already recurses + detects cycles, but only when
// it is handed a `getNestedGroup` resolver. The layer2 executor must inject one
// bound to the flat group registry (graphFile.groups) so a __group__ inner node
// resolves its sub-graph. Without it, the nested group yields {} and the value
// never threads through — the outer group's output is empty.

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyBatch, createRuntime, getGroup, executeNode, probeGroupInner } from '../layer2/index.js'
import { GROUP_OP_ID } from '../layer2/apply-batch.js'
import type { OpSpec } from '../layer1/index.js'

let scratch: string

beforeEach(() => {
  scratch = join(tmpdir(), `nest-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

function fresh() {
  const rt = createRuntime({ projectRoot: scratch, pipelineId: 'pnest', pluginId: 'plugin.test' })
  rt.registry.register(sourceOp)
  rt.registry.register(doubleOp)
  return rt
}

function entries(v: unknown): Array<{ path: number[]; items: unknown[] }> {
  return v as Array<{ path: number[]; items: unknown[] }>
}

describe('nested group execution', () => {
  it('executes a group whose member is itself a group', async () => {
    const rt = fresh()
    // s(5) -> m(double) -> k(double). Group {m} into g_inner, then group
    // {g_inner, k} into g_outer. Executing g_outer must recurse into g_inner so
    // m doubles 5->10 and k doubles 10->20.
    await applyBatch(rt, [
      { type: 'createNode', nodeId: 's', opId: 'kernel.source', position: { x: 0, y: 0 }, params: { value: 5 } },
      { type: 'createNode', nodeId: 'm', opId: 'kernel.double', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'k', opId: 'kernel.double', position: { x: 200, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e_sm', source: { nodeId: 's', port: 'out' }, target: { nodeId: 'm', port: 'in' } },
      { type: 'connect', edgeId: 'e_mk', source: { nodeId: 'm', port: 'out' }, target: { nodeId: 'k', port: 'in' } },
    ])

    const r1 = await applyBatch(rt, [
      { type: 'createGroup', groupId: 'g_inner', name: 'Inner', memberNodeIds: ['m'], position: { x: 100, y: 0 } },
    ])
    expect(r1.status).toBe('ok')

    const r2 = await applyBatch(rt, [
      { type: 'createGroup', groupId: 'g_outer', name: 'Outer', memberNodeIds: ['g_inner', 'k'], position: { x: 150, y: 0 } },
    ])
    expect(r2.status).toBe('ok')

    // Both groups persisted; g_outer holds g_inner as a nested __group__ member.
    expect(getGroup(rt, 'g_inner')).not.toBeNull()
    const outer = getGroup(rt, 'g_outer')!
    expect(outer).not.toBeNull()
    expect(outer.nodes.some((n) => n.id === 'g_inner' && n.opId === GROUP_OP_ID)).toBe(true)

    const result = await (await executeNode(rt, {})).done
    expect(result.status).not.toBe('error')

    // The core proof that the resolver fired: the nested g_inner doubled 5->10,
    // then k doubled 10->20, surfacing on g_outer's exposed output. Without the
    // resolver g_inner yields {} and k receives no input -> no value at all.
    const exposedOut = outer.exposedOutputs[0]!.portName
    expect(entries(result.outputs.g_outer![exposedOut])[0]!.items).toEqual([20])
  })

  it("probeGroupInner returns each inner node's real output (incl. nested) for the internal view", async () => {
    const rt = fresh()
    // s(5) -> m(double) -> k(double). Group {m} into g_inner, then {g_inner, k}
    // into g_outer. Probing g_outer must surface m's 10 (inside g_inner) and k's
    // 20 — the data the INTERNAL view shows on inner wires. This is exactly the
    // info the old black-box execution discarded ("any / no result" internally).
    await applyBatch(rt, [
      { type: 'createNode', nodeId: 's', opId: 'kernel.source', position: { x: 0, y: 0 }, params: { value: 5 } },
      { type: 'createNode', nodeId: 'm', opId: 'kernel.double', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'k', opId: 'kernel.double', position: { x: 200, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e_sm', source: { nodeId: 's', port: 'out' }, target: { nodeId: 'm', port: 'in' } },
      { type: 'connect', edgeId: 'e_mk', source: { nodeId: 'm', port: 'out' }, target: { nodeId: 'k', port: 'in' } },
    ])
    await applyBatch(rt, [
      { type: 'createGroup', groupId: 'g_inner', name: 'Inner', memberNodeIds: ['m'], position: { x: 100, y: 0 } },
    ])
    await applyBatch(rt, [
      { type: 'createGroup', groupId: 'g_outer', name: 'Outer', memberNodeIds: ['g_inner', 'k'], position: { x: 150, y: 0 } },
    ])
    // s feeds the group's exposed input — run the pipeline so s's output is cached
    // (probeGroupInner hydrates the group's external inputs from that cache).
    await (await executeNode(rt, {})).done

    const probe = await probeGroupInner(rt, 'g_outer')
    expect(probe).not.toBeNull()
    // k is a direct inner node of g_outer: doubled 10 -> 20.
    const kOut = Object.values(probe!['k']!)[0]
    expect(entries(kOut)[0]!.items).toEqual([20])
    // g_inner is a nested __group__ inner node: its exposed output carries m's 10.
    const innerBag = probe!['g_inner']!
    expect(Object.values(innerBag).some((v) => entries(v)[0]?.items?.[0] === 10)).toBe(true)
  })

  it('GCs an orphan sub-group after deleting its only parent', async () => {
    const rt = fresh()
    await applyBatch(rt, [
      { type: 'createNode', nodeId: 'x', opId: 'kernel.source', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'y', opId: 'kernel.double', position: { x: 50, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e_xy', source: { nodeId: 'x', port: 'out' }, target: { nodeId: 'y', port: 'in' } },
    ])
    await applyBatch(rt, [
      { type: 'createGroup', groupId: 'g_inner', name: 'Inner', memberNodeIds: ['x', 'y'], position: { x: 25, y: 0 } },
    ])
    await applyBatch(rt, [
      { type: 'createGroup', groupId: 'g_outer', name: 'Outer', memberNodeIds: ['g_inner'], position: { x: 30, y: 0 } },
    ])
    await applyBatch(rt, [{ type: 'deleteGroup', groupId: 'g_outer' }])
    expect(getGroup(rt, 'g_outer')).toBeNull()
    expect(getGroup(rt, 'g_inner')).toBeNull()
  })
})
