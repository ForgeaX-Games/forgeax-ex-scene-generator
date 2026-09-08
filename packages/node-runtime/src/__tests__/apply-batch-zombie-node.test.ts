// 2026-07-01 postmortem regression coverage.
//
// Sino (the scene-composer AI agent) sometimes wrote `id` instead of `nodeId`
// on a `createNode` batch op. Since applyBatch's HTTP boundary only has a TS
// type over the incoming `ops` array (`ops as never`) — no real runtime schema
// validation — `op.nodeId` silently evaluated to `undefined`. JS happily uses
// `undefined` as an object key (coerced to the string "undefined"), so the old
// code wrote a "zombie" node keyed `"undefined"` into the graph and returned
// `status: 'ok'`. Any later op in the batch that tried to reference the node's
// REAL intended id (e.g. "seed") then failed to resolve — or, if nothing else
// in the batch referenced it, the zombie node landed in the graph with no
// error at all. This file locks in the fix: missing/mistyped identifier
// fields must always produce a loud, structured, opIndex-addressed validation
// error instead of a silent zombie node or a silently-dropped reference.

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyBatch, createRuntime, getGroup, getPipeline } from '../layer2/index.js'
import type { OpSpec } from '../layer1/index.js'

let scratch: string

beforeEach(() => {
  scratch = join(tmpdir(), `forgeax-zombie-node-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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

describe('applyBatch zombie-node / dangling-reference validation (2026-07-01 postmortem)', () => {
  it('rejects a createNode op with `id` instead of `nodeId` — no zombie node, loud opIndex error', async () => {
    const runtime = fresh()
    const res = await applyBatch(runtime, [
      // The classic Sino mistake: `id` where the kernel requires `nodeId`.
      { type: 'createNode', id: 'seed', opId: 'kernel.source', params: { value: 1 } } as never,
    ])

    expect(res.status).toBe('rejected')
    expect(res.diagnostics).toBeTruthy()
    expect(res.diagnostics).toHaveLength(1)
    expect(res.diagnostics![0]).toMatchObject({ opIndex: 0, severity: 'error' })
    // Names the op index, the expected field, AND the wrong field the caller used.
    expect(res.diagnostics![0].message).toMatch(/createNode/)
    expect(res.diagnostics![0].message).toMatch(/nodeId/)
    expect(res.diagnostics![0].message).toMatch(/"id"/)

    // No zombie node was persisted — the graph is still empty.
    const snap = getPipeline(runtime)
    expect(snap ? Object.keys(snap.nodes).length : 0).toBe(0)
  })

  it('rejects a createNode op missing both `id` and `nodeId`', async () => {
    const runtime = fresh()
    const res = await applyBatch(runtime, [
      { type: 'createNode', opId: 'kernel.source', params: { value: 1 } } as never,
    ])

    expect(res.status).toBe('rejected')
    expect(res.diagnostics).toHaveLength(1)
    expect(res.diagnostics![0]).toMatchObject({ opIndex: 0, severity: 'error' })
    expect(res.diagnostics![0].message).toMatch(/nodeId/)

    const snap = getPipeline(runtime)
    expect(snap ? Object.keys(snap.nodes).length : 0).toBe(0)
  })

  it('rejects a batch where connect references a nodeId that was never created (field-name typo upstream)', async () => {
    const runtime = fresh()
    const res = await applyBatch(runtime, [
      // Same typo as above, but now paired with a connect that references the
      // intended id "seed" — before the fix this produced a confusing
      // "connect.source.nodeId seed does not exist" with no hint that the
      // real problem was the createNode op's field name.
      { type: 'createNode', id: 'seed', opId: 'kernel.source', params: { value: 1 } } as never,
      { type: 'createNode', nodeId: 'sink', opId: 'kernel.sink', params: {} },
      { type: 'connect', source: { nodeId: 'seed', port: 'out' }, target: { nodeId: 'sink', port: 'in' } },
    ])

    expect(res.status).toBe('rejected')
    // Atomic: nothing from this batch is persisted, including the valid `sink` node.
    const snap = getPipeline(runtime)
    expect(snap ? Object.keys(snap.nodes).length : 0).toBe(0)
  })

  it('rejects a connect op whose target nodeId does not exist anywhere (not in batch, not in graph)', async () => {
    const runtime = fresh()
    const res = await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'seed', opId: 'kernel.source', params: { value: 1 } },
      { type: 'connect', source: { nodeId: 'seed', port: 'out' }, target: { nodeId: 'does-not-exist', port: 'in' } },
    ])

    expect(res.status).toBe('rejected')
    expect(res.diagnostics).toHaveLength(1)
    const diag = res.diagnostics![0]
    expect(diag.opIndex).toBe(1)
    expect(diag.message).toMatch(/does-not-exist/)
    expect(diag.message).toMatch(/does not exist/)

    // Atomic rollback: the valid `seed` createNode from op[0] must not land either.
    const snap = getPipeline(runtime)
    expect(snap ? Object.keys(snap.nodes).length : 0).toBe(0)
  })

  it('rejects a connect op with a malformed source object instead of crashing', async () => {
    const runtime = fresh()
    const res = await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'seed', opId: 'kernel.source', params: { value: 1 } },
      { type: 'createNode', nodeId: 'sink', opId: 'kernel.sink', params: {} },
      // Missing `source` entirely — must be a diagnostic, not a thrown TypeError.
      { type: 'connect', target: { nodeId: 'sink', port: 'in' } } as never,
    ])

    expect(res.status).toBe('rejected')
    expect(res.diagnostics).toHaveLength(1)
    expect(res.diagnostics![0].opIndex).toBe(2)
    expect(res.diagnostics![0].message).toMatch(/source/)
  })

  it('rejects createGroup / updateGroup / deleteGroup / ungroup ops with a mistyped `id` instead of `groupId`', async () => {
    const runtime = fresh()
    // createGroup requires at least one real member to get to the groupId check
    // in a realistic shape, but the identifier check runs first regardless.
    const createRes = await applyBatch(runtime, [
      { type: 'createGroup', id: 'grp', name: 'Group', memberNodeIds: [] } as never,
    ])
    expect(createRes.status).toBe('rejected')
    expect(createRes.diagnostics![0].message).toMatch(/groupId/)

    const updateRes = await applyBatch(runtime, [{ type: 'updateGroup', id: 'grp', name: 'x' } as never])
    expect(updateRes.status).toBe('rejected')
    expect(updateRes.diagnostics![0].message).toMatch(/groupId/)

    const deleteRes = await applyBatch(runtime, [{ type: 'deleteGroup', id: 'grp' } as never])
    expect(deleteRes.status).toBe('rejected')
    expect(deleteRes.diagnostics![0].message).toMatch(/groupId/)

    const ungroupRes = await applyBatch(runtime, [{ type: 'ungroup', id: 'grp' } as never])
    expect(ungroupRes.status).toBe('rejected')
    expect(ungroupRes.diagnostics![0].message).toMatch(/groupId/)
  })

  // Regression: a normal, correctly-shaped batch (using the documented `nodeId` /
  // `edgeId` / `groupId` field names) must still apply end-to-end, unaffected by
  // the new structural validation.
  it('still applies a normal, correctly-shaped batch end-to-end (regression)', async () => {
    const runtime = fresh()
    const res = await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'seed', opId: 'kernel.source', params: { value: 7 } },
      { type: 'createNode', nodeId: 'sink', opId: 'kernel.sink', params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 'seed', port: 'out' }, target: { nodeId: 'sink', port: 'in' } },
      { type: 'createGroup', groupId: 'grp1', name: 'Group 1', memberNodeIds: ['seed', 'sink'] },
    ])

    expect(res.status).toBe('ok')
    const snap = getPipeline(runtime)!
    expect(snap.nodes.grp1).toBeTruthy()
    const group = getGroup(runtime, 'grp1')!
    expect(group.nodes.map((n) => n.id).sort()).toEqual(['seed', 'sink'])
    expect(group.edges.map((e) => e.id)).toEqual(['e1'])
  })
})
