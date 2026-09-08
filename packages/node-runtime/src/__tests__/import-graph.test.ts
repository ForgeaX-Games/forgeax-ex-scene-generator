// importPipelineGraph — faithful "load a graph from a file" port.
//
// Covers: kernel-graph-v1 + legacy-pipeline-v1 inputs produce the expected
// nodes/edges; replace deletes the prior graph; merge is additive with
// id-collision remap; an unknown opId yields a diagnostic (no crash, no
// mutation); viewport/annotations/frames round-trip through graph.metadata;
// the committed batch lands in history with the import actor/label; and a
// packed group round-trips (flatten → createGroup).

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyBatch, createRuntime, getGroup, getHistory, getPipeline, importPipelineGraph } from '../layer2/index.js'
import type { OpSpec } from '../layer1/types/op-spec.js'
import type { GraphNode } from '../layer1/types/graph.js'

let scratchDir: string

beforeEach(() => {
  scratchDir = join(tmpdir(), `forgeax-import-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(scratchDir, { recursive: true })
})
afterEach(() => {
  rmSync(scratchDir, { recursive: true, force: true })
})

function op(id: string): OpSpec {
  return { id, name: id, inputs: [{ name: 'in', type: 'any' }], outputs: [{ name: 'out', type: 'any' }], params: [], execute: () => null }
}

function fresh(opIds: string[] = ['demo.a', 'demo.b']) {
  const rt = createRuntime({ projectRoot: scratchDir, pipelineId: 'main', pluginId: 'plugin.test' })
  for (const id of opIds) rt.registry.register(op(id))
  return rt
}

describe('importPipelineGraph — kernel-graph-v1', () => {
  it('imports nodes + edges and replaces the live graph', async () => {
    const rt = fresh()
    // Seed a pre-existing node that replace must remove.
    await applyBatch(rt, [{ type: 'createNode', nodeId: 'old', opId: 'demo.a', position: { x: 0, y: 0 }, params: {} }])

    const res = await importPipelineGraph(rt, {
      format: 'kernel-graph-v1',
      graph: {
        nodes: [
          { id: 'n1', opId: 'demo.a', name: 'First', position: { x: 10, y: 20 }, params: { k: 1 } },
          { id: 'n2', opId: 'demo.b', position: { x: 30, y: 40 }, params: {} },
        ],
        edges: [{ id: 'e1', source: { nodeId: 'n1', port: 'out' }, target: { nodeId: 'n2', port: 'in' } }],
      },
    })

    expect(res.status).toBe('ok')
    const snap = getPipeline(rt)!
    expect(Object.keys(snap.nodes).sort()).toEqual(['n1', 'n2'])
    expect(snap.nodes.old).toBeUndefined()
    expect(snap.nodes.n1!.name).toBe('First')
    expect(snap.nodes.n1!.params).toEqual({ k: 1 })
    expect(Object.keys(snap.edges)).toEqual(['e1'])
    expect(snap.edges.e1!.target).toEqual({ nodeId: 'n2', port: 'in' })
  })

  it('records the committed batch in history with the import actor + label', async () => {
    const rt = fresh()
    await importPipelineGraph(
      rt,
      { format: 'kernel-graph-v1', graph: { nodes: [{ id: 'n1', opId: 'demo.a', position: { x: 0, y: 0 }, params: {} }], edges: [] } },
      { actor: 'ai:import', label: 'Import template X' },
    )
    const history = getHistory(rt)
    const entry = history.at(-1)!
    expect(entry.actor).toBe('ai:import')
    expect(entry.label).toBe('Import template X')
  })

  it('round-trips viewport / annotations / frames through graph.metadata', async () => {
    const rt = fresh()
    const viewport = { x: 5, y: 6, zoom: 1.5 }
    const annotations = [{ id: 'a1', text: 'hi', position: { x: 1, y: 2 } }]
    const frames = [{ id: 'f1', name: 'Frame', position: { x: 0, y: 0 }, width: 100, height: 80, nodeIds: ['n1'] }]
    await importPipelineGraph(rt, {
      format: 'kernel-graph-v1',
      graph: { nodes: [{ id: 'n1', opId: 'demo.a', position: { x: 0, y: 0 }, params: {} }], edges: [], metadata: { viewport, annotations, frames } },
    })
    const snap = getPipeline(rt)!
    expect(snap.metadata?.viewport).toEqual(viewport)
    expect(snap.metadata?.annotations).toEqual(annotations)
    expect(snap.metadata?.frames).toEqual(frames)
  })

  it('preserves the previewEnabled flag on import (P4)', async () => {
    const rt = fresh()
    // previewEnabled is a persisted editor toggle (survives a page reload), so a
    // re-imported graph (template drop / save-as-template round-trip) must keep it.
    const legacyNode = { id: 'n1', opId: 'demo.a', position: { x: 0, y: 0 }, params: {}, previewEnabled: false }
    const res = await importPipelineGraph(rt, {
      format: 'kernel-graph-v1',
      graph: { nodes: [legacyNode], edges: [] },
    })
    expect(res.status).toBe('ok')
    const snap = getPipeline(rt)!
    expect(snap.nodes.n1).toBeTruthy()
    expect((snap.nodes.n1 as GraphNode).previewEnabled).toBe(false)
  })
})

describe('importPipelineGraph — legacy-pipeline-v1', () => {
  it('maps batteryId → opId and round-trips the viewport', async () => {
    const rt = fresh(['wb.union', 'wb.grid'])
    const res = await importPipelineGraph(
      rt,
      {
        format: 'legacy-pipeline-v1',
        graph: {
          id: 'legacy',
          name: 'Legacy Scene',
          nodes: [
            { id: 'g', batteryId: 'legacyGrid', position: { x: 0, y: 0 }, params: { w: 4 } },
            { id: 'u', batteryId: 'legacyUnion', position: { x: 100, y: 0 }, params: {} },
          ],
          edges: [{ id: 'e', source: { nodeId: 'g', port: 'out' }, target: { nodeId: 'u', port: 'in' } }],
          viewport: { x: -10, y: -20, zoom: 0.75 },
        },
      },
      { opIdMap: { legacyGrid: 'wb.grid', legacyUnion: 'wb.union' } },
    )
    expect(res.status).toBe('ok')
    const snap = getPipeline(rt)!
    expect(snap.nodes.g!.opId).toBe('wb.grid')
    expect(snap.nodes.u!.opId).toBe('wb.union')
    expect(snap.metadata?.viewport).toEqual({ x: -10, y: -20, zoom: 0.75 })
  })
})

describe('importPipelineGraph — validation + remap', () => {
  it('rejects unknown opIds with a diagnostic and does not mutate', async () => {
    const rt = fresh(['demo.a'])
    await applyBatch(rt, [{ type: 'createNode', nodeId: 'keep', opId: 'demo.a', position: { x: 0, y: 0 }, params: {} }])

    const res = await importPipelineGraph(rt, {
      format: 'kernel-graph-v1',
      graph: { nodes: [{ id: 'n1', opId: 'does.not.exist', position: { x: 0, y: 0 }, params: {} }], edges: [] },
    })
    expect(res.status).toBe('rejected')
    expect(res.diagnostics?.[0]?.message).toContain('unknown opId')
    // Original graph untouched.
    const snap = getPipeline(rt)!
    expect(Object.keys(snap.nodes)).toEqual(['keep'])
  })

  it('accepts the __relay__ wire sentinel (not a registered op) on import', async () => {
    const rt = fresh(['demo.a'])
    const res = await importPipelineGraph(rt, {
      format: 'kernel-graph-v1',
      graph: {
        nodes: [
          { id: 'src', opId: 'demo.a', position: { x: 0, y: 0 }, params: {} },
          { id: 'r1', opId: '__relay__', position: { x: 100, y: 0 }, params: {} },
        ],
        edges: [{ id: 'e1', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'r1', port: 'input' } }],
      },
    })
    expect(res.status).toBe('ok')
    const snap = getPipeline(rt)!
    expect(snap.nodes['r1']?.opId).toBe('__relay__')
  })

  it('merge mode auto-remaps colliding node + edge ids', async () => {
    const rt = fresh()
    await applyBatch(rt, [
      { type: 'createNode', nodeId: 'n1', opId: 'demo.a', position: { x: 0, y: 0 }, params: {} },
    ])

    const res = await importPipelineGraph(
      rt,
      {
        format: 'kernel-graph-v1',
        graph: {
          nodes: [
            { id: 'n1', opId: 'demo.b', position: { x: 5, y: 5 }, params: {} },
            { id: 'n2', opId: 'demo.b', position: { x: 6, y: 6 }, params: {} },
          ],
          edges: [{ id: 'e', source: { nodeId: 'n1', port: 'out' }, target: { nodeId: 'n2', port: 'in' } }],
        },
      },
      { mode: 'merge' },
    )
    expect(res.status).toBe('ok')
    // Original n1 kept; incoming n1 remapped to a fresh id.
    expect(res.nodeIdMap!.n1).not.toBe('n1')
    const snap = getPipeline(rt)!
    expect(snap.nodes.n1!.opId).toBe('demo.a') // untouched original
    expect(Object.keys(snap.nodes)).toContain(res.nodeIdMap!.n1)
    // Edge endpoints follow the remap.
    const edge = Object.values(snap.edges)[0]!
    expect(edge.source.nodeId).toBe(res.nodeIdMap!.n1)
    expect(edge.target.nodeId).toBe(res.nodeIdMap!.n2)
  })

  it('honours an explicit idRemap', async () => {
    const rt = fresh()
    const res = await importPipelineGraph(
      rt,
      { format: 'kernel-graph-v1', graph: { nodes: [{ id: 'n1', opId: 'demo.a', position: { x: 0, y: 0 }, params: {} }], edges: [] } },
      { idRemap: { n1: 'renamed' } },
    )
    expect(res.status).toBe('ok')
    expect(res.nodeIdMap!.n1).toBe('renamed')
    expect(getPipeline(rt)!.nodes.renamed).toBeTruthy()
  })
})

describe('importPipelineGraph — groups', () => {
  it('round-trips a packed group (flatten → createNode → connect → createGroup)', async () => {
    const rt = fresh()
    // Build a grouped graph natively, export the snapshot, then re-import it.
    await applyBatch(rt, [
      { type: 'createNode', nodeId: 'a', opId: 'demo.a', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'b', opId: 'demo.b', position: { x: 50, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'c', opId: 'demo.a', position: { x: 100, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e_ab', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'b', port: 'in' } },
      { type: 'connect', edgeId: 'e_bc', source: { nodeId: 'b', port: 'out' }, target: { nodeId: 'c', port: 'in' } },
    ])
    await applyBatch(rt, [
      { type: 'createGroup', groupId: 'g1', name: 'Packed', memberNodeIds: ['a', 'b'], position: { x: 25, y: 0 } },
      { type: 'updateNode', nodeId: 'g1', params: { __sceneScriptFunctionName: 'packedDefinition' } },
    ])
    const before = getPipeline(rt)!
    const beforeGroup = getGroup(rt, 'g1')!
    const exported = {
      nodes: before.nodes,
      edges: before.edges,
      groups: { g1: beforeGroup },
    }

    const res = await importPipelineGraph(rt, { format: 'kernel-graph-v1', graph: exported }, { mode: 'replace' })
    expect(res.status).toBe('ok')

    const after = getPipeline(rt)!
    // Top-level: c + group shadow g1.
    expect(Object.keys(after.nodes).sort()).toEqual(['c', 'g1'])
    const afterGroup = getGroup(rt, 'g1')!
    expect(afterGroup.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(afterGroup.edges.map((e) => e.id)).toEqual(['e_ab'])
    expect(after.nodes.g1?.params).toMatchObject({
      groupId: 'g1',
      __sceneScriptFunctionName: 'packedDefinition',
    })
    // Boundary edge b→c rewritten to reference the group again.
    expect(after.edges.e_bc!.source.nodeId).toBe('g1')
  })

  it('materializes nested groups and rewrites their boundary edges before replay', async () => {
    const rt = fresh()
    const nested = {
      id: 'inner',
      name: 'Inner',
      nodes: [{ id: 'inner_node', opId: 'demo.a', position: { x: 0, y: 0 }, params: {} }],
      edges: [],
      position: { x: 20, y: 20 },
      exposedInputs: [
        { portName: 'in_0', portType: 'any', sourceNodeId: 'inner_node', sourcePortName: 'in' },
      ],
      exposedOutputs: [
        { portName: 'out_0', portType: 'any', sourceNodeId: 'inner_node', sourcePortName: 'out' },
      ],
    }
    const outer = {
      id: 'outer',
      name: 'Outer',
      nodes: [
        { id: 'inner', opId: '__group__', position: { x: 20, y: 20 }, params: { groupId: 'inner' } },
        { id: 'outer_node', opId: 'demo.b', position: { x: 80, y: 20 }, params: {} },
      ],
      edges: [
        {
          id: 'e_nested',
          source: { nodeId: 'inner', port: 'out_0' },
          target: { nodeId: 'outer_node', port: 'in' },
        },
      ],
      position: { x: 50, y: 50 },
      exposedInputs: [
        { portName: 'in_0', portType: 'any', sourceNodeId: 'inner', sourcePortName: 'in_0' },
      ],
      exposedOutputs: [
        { portName: 'out_0', portType: 'any', sourceNodeId: 'outer_node', sourcePortName: 'out' },
      ],
      _nestedGroups: [nested],
    }

    const res = await importPipelineGraph(rt, {
      format: 'kernel-graph-v1',
      graph: {
        nodes: [
          { id: 'source', opId: 'demo.a', position: { x: 0, y: 0 }, params: {} },
          { id: 'outer', opId: '__group__', position: { x: 50, y: 50 }, params: { groupId: 'outer' } },
          { id: 'sink', opId: 'demo.b', position: { x: 150, y: 0 }, params: {} },
        ],
        edges: [
          { id: 'e_in', source: { nodeId: 'source', port: 'out' }, target: { nodeId: 'outer', port: 'in_0' } },
          { id: 'e_out', source: { nodeId: 'outer', port: 'out_0' }, target: { nodeId: 'sink', port: 'in' } },
        ],
        groups: [outer],
      },
    })

    expect(res.status).toBe('ok')
    expect(getGroup(rt, 'inner')?.nodes.map((node) => node.id)).toEqual(['inner_node'])
    expect(getGroup(rt, 'outer')?.nodes.map((node) => node.id).sort()).toEqual(['inner', 'outer_node'])
    expect(getGroup(rt, 'outer')?.edges.map((edge) => edge.id)).toContain('e_nested')
    const after = getPipeline(rt)!
    expect(after.edges.e_in?.target).toEqual({ nodeId: 'outer', port: 'in_0' })
    expect(after.edges.e_out?.source).toEqual({ nodeId: 'outer', port: 'out_0' })
  })

  it('drops an orphan __group__ shadow (no NodeGroup definition) + its dangling edges, keeps the rest', async () => {
    // A malformed/partial save: a __group__ node sits in `nodes` with edges into
    // it, but its NodeGroup is missing from `groups` — so it can't be recreated.
    const rt = fresh(['demo.a', 'demo.b'])
    const res = await importPipelineGraph(
      rt,
      {
        format: 'kernel-graph-v1',
        graph: {
          nodes: [
            { id: 'a', opId: 'demo.a', position: { x: 0, y: 0 }, params: {} },
            { id: 'b', opId: 'demo.b', position: { x: 50, y: 0 }, params: {} },
            { id: 'orphan_group', opId: '__group__', position: { x: 100, y: 0 }, params: {} },
          ],
          edges: [
            { id: 'e_ok', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'b', port: 'in' } },
            { id: 'e_bad', source: { nodeId: 'a', port: 'out' }, target: { nodeId: 'orphan_group', port: 'in__0746__x' } },
          ],
          groups: {}, // orphan_group has no definition here
        },
      },
      { mode: 'replace' },
    )
    expect(res.status).toBe('ok')
    const after = getPipeline(rt)!
    // Orphan shadow dropped; real nodes kept.
    expect(Object.keys(after.nodes).sort()).toEqual(['a', 'b'])
    // The good edge survives; the dangling edge into the orphan is dropped.
    expect(after.edges.e_ok).toBeTruthy()
    expect(after.edges.e_bad).toBeUndefined()
  })
})
