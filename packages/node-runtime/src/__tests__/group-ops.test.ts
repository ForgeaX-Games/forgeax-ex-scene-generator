// Layer 2 Group Ops — createGroup / updateGroup / ungroup round-trip.
//
// Exercises the core group flow:
//   1. Three-node graph with two boundary-crossing edges + one
//      internal-only edge wraps into a group.
//   2. Outer edges get rewritten to reference the group via synthetic
//      exposed-port names; the internal edge moves into the sub-graph.
//   3. updateGroup mutates name/position on both the shadow node AND
//      the sub-graph entry.
//   4. ungroup restores everything: members + internal edges return to
//      top level, outer edges rewrite back to the original endpoints.
//   5. Validation: missing member, non-existent group.

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  applyBatch,
  createRuntime,
  getGroup,
  getPipeline,
  listGroups,
  listNodes,
} from '../layer2/index.js'
import { GROUP_OP_ID } from '../layer2/apply-batch.js'

let scratchDir: string

beforeEach(() => {
  scratchDir = join(tmpdir(), `forgeax-group-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratchDir, { recursive: true })
})

afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

function fresh() {
  return createRuntime({
    projectRoot: scratchDir,
    pipelineId: 'pgroup',
    pluginId: 'plugin.test',
  })
}

async function seedTriangle(runtime: ReturnType<typeof fresh>) {
  // a -> b -> c (linear), plus an outsider d connected into b.
  // Grouping {a, b} should:
  //   - move a, b out of top level
  //   - move edge a→b into the group's internal edges
  //   - rewrite edge d→b's target to the group (with an input exposed port)
  //   - rewrite edge b→c's source to the group (with an output exposed port)
  await applyBatch(runtime, [
    { type: 'createNode', nodeId: 'a', opId: 'demo.echo', position: { x: 0, y: 0 }, params: {} },
    { type: 'createNode', nodeId: 'b', opId: 'demo.echo', position: { x: 100, y: 0 }, params: {} },
    { type: 'createNode', nodeId: 'c', opId: 'demo.echo', position: { x: 200, y: 0 }, params: {} },
    { type: 'createNode', nodeId: 'd', opId: 'demo.echo', position: { x: 0, y: 100 }, params: {} },
    { type: 'connect', edgeId: 'e_ab', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'b', port: 'in' } },
    { type: 'connect', edgeId: 'e_bc', source: { nodeId: 'b', port: 'out' }, target: { nodeId: 'c', port: 'in' } },
    { type: 'connect', edgeId: 'e_db', source: { nodeId: 'd', port: 'out' }, target: { nodeId: 'b', port: 'aux' } },
  ])
}

describe('Layer 2 Group Ops', () => {
  it('createGroup wraps members, rewires boundary edges, derives exposed ports', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)

    const result = await applyBatch(runtime, [
      {
        type: 'createGroup',
        groupId: 'g1',
        name: 'Inner',
        memberNodeIds: ['a', 'b'],
        position: { x: 50, y: 0 },
      },
    ])
    expect(result.status).toBe('ok')

    const snap = getPipeline(runtime)
    expect(snap).not.toBeNull()
    // Top-level nodes: c, d, plus the group shadow node g1. a + b moved into the group.
    expect(Object.keys(snap!.nodes).sort()).toEqual(['c', 'd', 'g1'])
    expect(snap!.nodes.g1!.opId).toBe(GROUP_OP_ID)
    expect(snap!.nodes.g1!.name).toBe('Inner')
    expect(snap!.nodes.g1!.params).toEqual({ groupId: 'g1' })

    // Outer edges: e_db (rewritten) + e_bc (rewritten). Internal edge e_ab moved into group.
    expect(Object.keys(snap!.edges).sort()).toEqual(['e_bc', 'e_db'])
    expect(snap!.edges.e_db!.target.nodeId).toBe('g1')
    expect(snap!.edges.e_bc!.source.nodeId).toBe('g1')

    const group = getGroup(runtime, 'g1')
    expect(group).not.toBeNull()
    expect(group!.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(group!.edges.map((e) => e.id)).toEqual(['e_ab'])
    // d→b became an input on the group; b→c became an output.
    expect(group!.exposedInputs.map((p) => p.sourceNodeId)).toEqual(['b'])
    expect(group!.exposedInputs[0]!.sourcePortName).toBe('aux')
    expect(group!.exposedOutputs.map((p) => p.sourceNodeId)).toEqual(['b'])
    expect(group!.exposedOutputs[0]!.sourcePortName).toBe('out')

    // listGroups returns it.
    expect(listGroups(runtime).map((g) => g.id)).toEqual(['g1'])
  })

  it('updateGroup mutates name + position on both shadow node and group entry', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)
    await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g1', name: 'Old', memberNodeIds: ['a', 'b'], position: { x: 0, y: 0 } },
    ])

    await applyBatch(runtime, [
      { type: 'updateGroup', groupId: 'g1', name: 'New', position: { x: 999, y: 999 } },
    ])

    const group = getGroup(runtime, 'g1')!
    expect(group.name).toBe('New')
    expect(group.position).toEqual({ x: 999, y: 999 })
    const node = listNodes(runtime).find((n) => n.id === 'g1')!
    expect(node.name).toBe('New')
    expect(node.position).toEqual({ x: 999, y: 999 })
  })

  it('updateGroup persists inner sub-graph edits (edges / nodes / innerLayout) for an existing group', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)
    await applyBatch(runtime, [
      // Group all three so there are two members to wire internally (a, c) plus b.
      { type: 'createGroup', groupId: 'g1', name: 'G', memberNodeIds: ['a', 'b', 'c'], position: { x: 0, y: 0 } },
    ])

    const before = getGroup(runtime, 'g1')!
    const beforeEdgeCount = before.edges.length
    // Simulate an internal-view edit: add a new member-to-member edge (a.aux→c.in),
    // nudge an inner node's layout, and bump an inner node's params — exactly what
    // the editor flushes on exit. The kernel must REPLACE the sub-graph fields.
    const nextEdges = [
      ...before.edges,
      { id: 'e_inner_ac', source: { nodeId: 'a', port: 'aux' }, target: { nodeId: 'c', port: 'in' } },
    ]
    const nextNodes = before.nodes.map((n) =>
      n.id === 'a' ? { ...n, params: { ...n.params, tweaked: 42 } } : n,
    )
    await applyBatch(runtime, [
      {
        type: 'updateGroup',
        groupId: 'g1',
        edges: nextEdges,
        nodes: nextNodes,
        innerLayout: { a: { x: 11, y: 22 } },
      },
    ])

    // Re-pull from the kernel SSOT (mirrors getPipeline after graph:applied).
    const after = getGroup(runtime, 'g1')!
    expect(after.edges.length).toBe(beforeEdgeCount + 1)
    expect(after.edges.some((e) => e.id === 'e_inner_ac')).toBe(true)
    expect(after.innerLayout).toEqual({ a: { x: 11, y: 22 } })
    expect(after.nodes.find((n) => n.id === 'a')!.params.tweaked).toBe(42)
  })

  it('updateGroup patches exposed-port overlay (hidden/order/label) by portName and persists', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)
    await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g1', name: 'G', memberNodeIds: ['a', 'b'], position: { x: 0, y: 0 } },
    ])

    const before = getGroup(runtime, 'g1')!
    const inName = before.exposedInputs[0]!.portName
    const outName = before.exposedOutputs[0]!.portName
    // Baseline: kernel derives ports with no overlay fields set.
    expect(before.exposedInputs[0]!.hidden).toBeUndefined()
    expect(before.exposedInputs[0]!.order).toBeUndefined()

    const res = await applyBatch(runtime, [
      {
        type: 'updateGroup',
        groupId: 'g1',
        exposedPorts: {
          inputs: [{ portName: inName, hidden: true, order: 3, customLabel: '入', customLabelEn: 'In' }],
          outputs: [{ portName: outName, order: 7 }],
        },
      },
    ])
    expect(res.status).toBe('ok')

    const after = getGroup(runtime, 'g1')!
    const inPort = after.exposedInputs.find((p) => p.portName === inName)!
    expect(inPort.hidden).toBe(true)
    expect(inPort.order).toBe(3)
    expect(inPort.customLabel).toBe('入')
    expect(inPort.customLabelEn).toBe('In')
    // Wiring authority is untouched by an overlay patch.
    expect(inPort.sourceNodeId).toBe(before.exposedInputs[0]!.sourceNodeId)
    expect(inPort.sourcePortName).toBe(before.exposedInputs[0]!.sourcePortName)
    expect(inPort.portType).toBe(before.exposedInputs[0]!.portType)
    expect(after.exposedOutputs.find((p) => p.portName === outName)!.order).toBe(7)

    // getGroup reads graph.json fresh on each call, so a second read proves the
    // overlay was persisted (not just held in memory).
    const reread = getGroup(runtime, 'g1')!
    expect(reread.exposedInputs.find((p) => p.portName === inName)!.hidden).toBe(true)
  })

  it('updateGroup replaces the exposed-port set wholesale via exposedWiring (shell add/delete/rebind)', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)
    await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g1', name: 'G', memberNodeIds: ['a', 'b'], position: { x: 0, y: 0 } },
    ])
    const before = getGroup(runtime, 'g1')!
    const keep = before.exposedInputs[0]!

    // Add a brand-new placeholder port (empty mapping, like `+新建端口`) alongside
    // the existing one — something the overlay-only patch cannot express.
    const res = await applyBatch(runtime, [
      {
        type: 'updateGroup',
        groupId: 'g1',
        exposedWiring: {
          inputs: [
            { ...keep },
            { portName: 'in_new', portType: 'any', sourceNodeId: '', sourcePortName: '', order: 99 },
          ],
        },
      },
    ])
    expect(res.status).toBe('ok')

    // Re-read from graph.json proves the new port persisted (not just in memory).
    const added = getGroup(runtime, 'g1')!
    expect(added.exposedInputs.map((p) => p.portName).sort()).toEqual([keep.portName, 'in_new'].sort())
    const placeholder = added.exposedInputs.find((p) => p.portName === 'in_new')!
    expect(placeholder.sourceNodeId).toBe('')
    expect(placeholder.order).toBe(99)

    // True-delete: replace with just the kept port → the placeholder is gone.
    await applyBatch(runtime, [
      { type: 'updateGroup', groupId: 'g1', exposedWiring: { inputs: [{ ...keep }] } },
    ])
    const removed = getGroup(runtime, 'g1')!
    expect(removed.exposedInputs.some((p) => p.portName === 'in_new')).toBe(false)
    expect(removed.exposedInputs.length).toBe(1)
  })

  it('updateGroup overlay patch is incremental — unspecified fields and unknown ports are preserved/ignored', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)
    await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g1', name: 'G', memberNodeIds: ['a', 'b'], position: { x: 0, y: 0 } },
    ])
    const inName = getGroup(runtime, 'g1')!.exposedInputs[0]!.portName

    await applyBatch(runtime, [
      { type: 'updateGroup', groupId: 'g1', exposedPorts: { inputs: [{ portName: inName, hidden: true, order: 2 }] } },
    ])
    // Second patch only flips hidden back; order must be preserved.
    await applyBatch(runtime, [
      {
        type: 'updateGroup',
        groupId: 'g1',
        exposedPorts: { inputs: [{ portName: inName, hidden: false }, { portName: 'no-such-port', hidden: true }] },
      },
    ])

    const port = getGroup(runtime, 'g1')!.exposedInputs.find((p) => p.portName === inName)!
    expect(port.hidden).toBe(false)
    expect(port.order).toBe(2)
    // Unknown portName was silently ignored — no phantom port added.
    expect(getGroup(runtime, 'g1')!.exposedInputs.some((p) => p.portName === 'no-such-port')).toBe(false)
  })

  it('createGroup honours an authoritative exposed-port contract (drag-a-saved-group-back path)', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)

    // The template carries STABLE portNames minted at the group's birth (here
    // `pin`/`pout`) bound to their inner mapping. The kernel honours them
    // verbatim and rewrites boundary edges to them — so the group keeps its
    // outward identity even though inner ids are arbitrary.
    const inName = 'pin'
    const outName = 'pout'

    const res = await applyBatch(runtime, [
      {
        type: 'createGroup',
        groupId: 'g1',
        name: 'Reused',
        memberNodeIds: ['a', 'b'],
        position: { x: 50, y: 0 },
        exposedPorts: {
          inputs: [{ portName: inName, sourceNodeId: 'b', sourcePortName: 'aux', hidden: true, order: 5, customLabel: '入', customLabelEn: 'In' }],
          outputs: [{ portName: outName, sourceNodeId: 'b', sourcePortName: 'out', order: 2 }],
        },
      },
    ])
    expect(res.status).toBe('ok')

    const group = getGroup(runtime, 'g1')!
    const inPort = group.exposedInputs.find((p) => p.portName === inName)!
    // Stable contract name landed, with overlay…
    expect(inPort.hidden).toBe(true)
    expect(inPort.order).toBe(5)
    expect(inPort.customLabel).toBe('入')
    expect(inPort.customLabelEn).toBe('In')
    // …while the wiring authority stays derived from the live topology.
    expect(inPort.sourceNodeId).toBe('b')
    expect(inPort.sourcePortName).toBe('aux')
    expect(inPort.portType).toBe('any')
    expect(group.exposedOutputs.find((p) => p.portName === outName)!.order).toBe(2)
    // Boundary edges were rewritten to the stable contract names.
    const snap = getPipeline(runtime)!
    expect(snap.edges.e_db!.target).toEqual({ nodeId: 'g1', port: inName })
    expect(snap.edges.e_bc!.source).toEqual({ nodeId: 'g1', port: outName })
    // Group name carries the user's custom name (Bug 2 guard).
    expect(group.name).toBe('Reused')
    const reread = getGroup(runtime, 'g1')!
    expect(reread.exposedInputs.find((p) => p.portName === inName)!.hidden).toBe(true)
  })

  it('createGroup honours an explicit contract portType override (fallback to derived when absent)', async () => {
    // Repro guard for the "drag a saved group back → port type reverts → unsaved*"
    // bug: a saved group carries a user-set boundary portType. createGroup must
    // honour it verbatim instead of always re-deriving from the inner OpSpec.
    const runtime = fresh()
    await seedTriangle(runtime)

    const res = await applyBatch(runtime, [
      {
        type: 'createGroup',
        groupId: 'g1',
        name: 'Typed',
        memberNodeIds: ['a', 'b'],
        position: { x: 50, y: 0 },
        exposedPorts: {
          // `aux` derives to 'any'; the contract overrides it to 'string'.
          inputs: [{ portName: 'pin', sourceNodeId: 'b', sourcePortName: 'aux', portType: 'string' }],
          // No portType → still derived from the inner member's OpSpec.
          outputs: [{ portName: 'pout', sourceNodeId: 'b', sourcePortName: 'out' }],
        },
      },
    ])
    expect(res.status).toBe('ok')

    const group = getGroup(runtime, 'g1')!
    expect(group.exposedInputs.find((p) => p.portName === 'pin')!.portType).toBe('string')
    // Omitted override falls back to derivation (unchanged behaviour).
    expect(group.exposedOutputs.find((p) => p.portName === 'pout')!.portType).not.toBe('string')
  })

  it('with a contract, does NOT auto-expose members\u2019 unconnected input ports (no phantom any slots)', async () => {
    // Repro of the user bug: grouping a wired battery, the frontend hands an
    // authoritative contract listing ONLY the real boundary ports. Members that
    // happen to have unconnected input ports (e.g. inner Panel `input` slots)
    // must NOT leak as extra `any` inputs — the contract is the SSOT for the
    // boundary surface. (Without the gate, the fallback supplement exposed every
    // member's idle input as in_2/in_3/in_4 → "any / no result" pollution.)
    const runtime = fresh()
    // src -> mid(scene/aux/out via demo.echo); mid has an idle `aux` input. Group
    // {mid} with a contract exposing only mid.in (boundary) + mid.out.
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'src', opId: 'demo.echo', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'mid', opId: 'demo.echo', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'dst', opId: 'demo.echo', position: { x: 200, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e_sm', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'mid', port: 'in' } },
      { type: 'connect', edgeId: 'e_md', source: { nodeId: 'mid', port: 'out' }, target: { nodeId: 'dst', port: 'in' } },
    ])
    const res = await applyBatch(runtime, [
      {
        type: 'createGroup', groupId: 'g1', name: 'Inner', memberNodeIds: ['mid'], position: { x: 100, y: 0 },
        exposedPorts: {
          inputs: [{ portName: 'in_0', sourceNodeId: 'mid', sourcePortName: 'in' }],
          outputs: [{ portName: 'out_0', sourceNodeId: 'mid', sourcePortName: 'out' }],
        },
      },
    ])
    expect(res.status).toBe('ok')
    const group = getGroup(runtime, 'g1')!
    // EXACTLY the contract surface — no phantom `mid.aux` slot leaked in.
    expect(group.exposedInputs.map((p) => `${p.portName}:${p.sourceNodeId}.${p.sourcePortName}`)).toEqual(['in_0:mid.in'])
    expect(group.exposedOutputs.map((p) => `${p.portName}:${p.sourceNodeId}.${p.sourcePortName}`)).toEqual(['out_0:mid.out'])
    // Boundary edges still rewired to the stable contract names.
    const snap = getPipeline(runtime)!
    expect(snap.edges.e_sm!.target).toEqual({ nodeId: 'g1', port: 'in_0' })
    expect(snap.edges.e_md!.source).toEqual({ nodeId: 'g1', port: 'out_0' })
  })

  it('createGroup contract entry whose mapping matches no live port is dropped (advisory)', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)
    const res = await applyBatch(runtime, [
      {
        type: 'createGroup',
        groupId: 'g1',
        name: 'Inner',
        memberNodeIds: ['a', 'b'],
        position: { x: 0, y: 0 },
        // sourceNodeId 'b' / sourcePortName 'aux' is a real boundary input, but
        // 'ghost' references no member port → that entry never binds and the
        // real boundary still gets a freshly-allocated stable name.
        exposedPorts: { inputs: [{ portName: 'phantom', sourceNodeId: 'ghost', sourcePortName: 'x', hidden: true }] },
      },
    ])
    expect(res.status).toBe('ok')
    const group = getGroup(runtime, 'g1')!
    // The phantom contract entry matched no live port → no phantom port created.
    expect(group.exposedInputs.some((p) => p.portName === 'phantom')).toBe(false)
    // The real boundary input is exposed under a fresh stable id, visible.
    const realIn = group.exposedInputs.find((p) => p.sourceNodeId === 'b' && p.sourcePortName === 'aux')!
    expect(realIn).toBeDefined()
    expect(realIn.portName).toMatch(/^in_\d+$/)
    expect(realIn.hidden).toBeUndefined()
  })

  it('createGroup materializes contract ports even with NO boundary edges (drag-saved-template-onto-blank-canvas)', async () => {
    // Repro of the user bug: "保存到 group 分类中的节点组电池，拖出来使用的时候所有的
    // 输入输出槽位都自动消失了". A saved group template dropped onto a blank canvas
    // has NO external wiring yet, so deriveGroupPorts emits EMPTY arrays. The
    // contract is the AUTHORITATIVE port set and must still materialize every
    // exposed port (with the resolved inner tier + overlay) — slots must NOT vanish.
    const runtime = fresh()
    runtime.registry.register({
      id: 'demo.tile-name',
      inputs: [
        { name: 'scene', type: 'scene', access: 'item' },
        { name: 'value', type: 'string', access: 'item' },
      ],
      outputs: [{ name: 'scene', type: 'scene', access: 'item' }],
      params: [],
      execute: () => ({ scene: null }),
    })

    // Two members, NO edges at all crossing (or even existing on) the boundary →
    // deriveGroupPorts returns empty → without the fix the contract is discarded.
    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'm_in', opId: 'demo.tile-name', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'm_out', opId: 'demo.tile-name', position: { x: 100, y: 0 }, params: {} },
    ])

    const res = await applyBatch(runtime, [
      {
        type: 'createGroup',
        groupId: 'g1',
        name: 'SetTileName',
        memberNodeIds: ['m_in', 'm_out'],
        position: { x: 50, y: 0 },
        exposedPorts: {
          inputs: [
            { portName: 'in_0', sourceNodeId: 'm_in', sourcePortName: 'value' },
            { portName: 'in_1', sourceNodeId: 'm_in', sourcePortName: 'scene', hidden: true },
          ],
          outputs: [{ portName: 'out_0', sourceNodeId: 'm_out', sourcePortName: 'scene', order: 2 }],
        },
      },
    ])
    expect(res.status).toBe('ok')

    const group = getGroup(runtime, 'g1')!
    // Slots did NOT vanish: every contract port is materialized with its stable name.
    expect(group.exposedInputs.map((p) => p.portName).sort()).toEqual(['in_0', 'in_1'])
    expect(group.exposedOutputs.map((p) => p.portName)).toEqual(['out_0'])

    // portType is resolved from the inner member's OpSpec (not trusted off contract).
    const valueIn = group.exposedInputs.find((p) => p.portName === 'in_0')!
    expect(valueIn.sourceNodeId).toBe('m_in')
    expect(valueIn.sourcePortName).toBe('value')
    expect(valueIn.portType).toBe('string')

    const sceneIn = group.exposedInputs.find((p) => p.portName === 'in_1')!
    expect(sceneIn.portType).toBe('scene')
    // Overlay (hidden) survives.
    expect(sceneIn.hidden).toBe(true)

    const sceneOut = group.exposedOutputs.find((p) => p.portName === 'out_0')!
    expect(sceneOut.sourceNodeId).toBe('m_out')
    expect(sceneOut.sourcePortName).toBe('scene')
    expect(sceneOut.portType).toBe('scene')
    expect(sceneOut.order).toBe(2)
  })

  it('ungroup restores members + internal edges + rewrites outer edges back', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)
    await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g1', name: 'Inner', memberNodeIds: ['a', 'b'], position: { x: 0, y: 0 } },
    ])

    const result = await applyBatch(runtime, [{ type: 'ungroup', groupId: 'g1' }])
    expect(result.status).toBe('ok')

    const snap = getPipeline(runtime)!
    // All 4 nodes back at top level; g1 gone.
    expect(Object.keys(snap.nodes).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(snap.nodes.g1).toBeUndefined()
    // All 3 edges back, with original endpoints.
    expect(Object.keys(snap.edges).sort()).toEqual(['e_ab', 'e_bc', 'e_db'])
    expect(snap.edges.e_ab!.source.nodeId).toBe('a')
    expect(snap.edges.e_ab!.target.nodeId).toBe('b')
    expect(snap.edges.e_db!.target.nodeId).toBe('b')
    expect(snap.edges.e_db!.target.port).toBe('aux')
    expect(snap.edges.e_bc!.source.nodeId).toBe('b')
    expect(snap.edges.e_bc!.source.port).toBe('out')

    expect(listGroups(runtime)).toEqual([])
  })

  it('deleteGroup removes the composite without restoring inner members', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)
    await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g1', name: 'Inner', memberNodeIds: ['a', 'b'], position: { x: 0, y: 0 } },
    ])

    const result = await applyBatch(runtime, [{ type: 'deleteGroup', groupId: 'g1' }])
    expect(result.status).toBe('ok')

    const snap = getPipeline(runtime)!
    expect(Object.keys(snap.nodes).sort()).toEqual(['c', 'd'])
    expect(snap.nodes.g1).toBeUndefined()
    expect(Object.keys(snap.edges)).toEqual([])
    expect(listGroups(runtime)).toEqual([])
  })

  it('rejects createGroup with a missing member', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)
    const result = await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g1', name: 'X', memberNodeIds: ['a', 'nope'], position: { x: 0, y: 0 } },
    ])
    expect(result.status).toBe('rejected')
    expect(result.diagnostics?.[0]?.message).toContain('member nope does not exist')
    // Original graph untouched.
    expect(listNodes(runtime).map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('rejects ungroup of a non-existent group', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)
    const result = await applyBatch(runtime, [{ type: 'ungroup', groupId: 'nope' }])
    expect(result.status).toBe('rejected')
  })

  it('createGroup resolves real boundary port type + access from member OpSpecs', async () => {
    const runtime = fresh()
    runtime.registry.register({
      id: 'demo.scene-source',
      inputs: [{ name: 'seed', type: 'string', access: 'item' }],
      outputs: [{ name: 'out', type: 'scene', access: 'item' }],
      params: [],
      execute: () => ({ out: null }),
    })
    runtime.registry.register({
      id: 'demo.scene-sink',
      inputs: [{ name: 'scene', type: 'scene', access: 'list' }],
      outputs: [{ name: 'done', type: 'string', access: 'item' }],
      params: [],
      execute: () => ({ done: 'ok' }),
    })

    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'src', opId: 'demo.scene-source', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'snk', opId: 'demo.scene-sink', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'down', opId: 'demo.scene-sink', position: { x: 200, y: 0 }, params: {} },
      // upstream feeds the grouped sink's input (boundary input)
      { type: 'connect', edgeId: 'e1', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'snk', port: 'scene' } },
      // grouped sink's output feeds an outside node (boundary output)
      { type: 'connect', edgeId: 'e2', source: { nodeId: 'snk', port: 'done' }, target: { nodeId: 'down', port: 'scene' } },
    ])

    const result = await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g1', name: 'Sink', memberNodeIds: ['snk'], position: { x: 50, y: 0 } },
    ])
    expect(result.status).toBe('ok')

    const group = getGroup(runtime, 'g1')!
    // Input boundary mirrors snk.scene → type 'scene', access 'list'.
    expect(group.exposedInputs).toHaveLength(1)
    expect(group.exposedInputs[0]!.portType).toBe('scene')
    expect(group.exposedInputs[0]!.access).toBe('list')
    // Output boundary mirrors snk.done → type 'string', access 'item'.
    expect(group.exposedOutputs).toHaveLength(1)
    expect(group.exposedOutputs[0]!.portType).toBe('string')
    expect(group.exposedOutputs[0]!.access).toBe('item')
  })

  it('createGroup resolves dynamic-port boundary type/access from the dynamic template', async () => {
    const runtime = fresh()
    runtime.registry.register({
      id: 'demo.tree-merge',
      inputs: [],
      outputs: [{ name: 'tree', type: 'any', access: 'tree' }],
      params: [],
      dynamicInputs: { prefix: 'item_', labelTemplate: '[$i]', minCount: 2, type: 'any', access: 'tree' },
      execute: () => ({ tree: null }),
    })
    runtime.registry.register({
      id: 'demo.scene-source',
      inputs: [],
      outputs: [{ name: 'out', type: 'scene', access: 'item' }],
      params: [],
      execute: () => ({ out: null }),
    })

    await applyBatch(runtime, [
      { type: 'createNode', nodeId: 'src', opId: 'demo.scene-source', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'mg', opId: 'demo.tree-merge', position: { x: 100, y: 0 }, params: { portCount: 2 } },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'mg', port: 'item_0' } },
    ])

    const result = await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g1', name: 'Merge', memberNodeIds: ['mg'], position: { x: 50, y: 0 } },
    ])
    expect(result.status).toBe('ok')

    const group = getGroup(runtime, 'g1')!
    // The dynamic input slot item_0 resolves from dynamicInputs → 'any' / 'tree'.
    expect(group.exposedInputs).toHaveLength(1)
    expect(group.exposedInputs[0]!.sourcePortName).toBe('item_0')
    expect(group.exposedInputs[0]!.portType).toBe('any')
    expect(group.exposedInputs[0]!.access).toBe('tree')
  })

  it('leaves boundary ports as untyped any when member ops are unregistered', async () => {
    const runtime = fresh()
    await seedTriangle(runtime)
    await applyBatch(runtime, [
      { type: 'createGroup', groupId: 'g1', name: 'Inner', memberNodeIds: ['a', 'b'], position: { x: 0, y: 0 } },
    ])
    const group = getGroup(runtime, 'g1')!
    expect(group.exposedInputs[0]!.portType).toBe('any')
    expect(group.exposedInputs[0]!.access).toBeUndefined()
    expect(group.exposedOutputs[0]!.portType).toBe('any')
  })
})
