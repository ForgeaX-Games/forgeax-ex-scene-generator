// Regression test for the dangling redirected-edge / ReactFlow #008 fix.
//
// A `__group__` node only renders Handles for its NON-hidden exposed ports
// (GroupNode → getVisibleGroupPorts). The kernel graph, however, keeps the
// wiring: a redirected (`*_redir`) edge created at group time still targets the
// exposed port's handle. When that port is later hidden (via the client overlay
// or a dropped saved-group template that carries a hidden flag), the handle is
// no longer painted, so ReactFlow logs error #008 ("Couldn't create edge for
// target handle id …") — and re-logs it on EVERY committed batch's rebuild,
// including a plain unrelated node-drag's persist round-trip.
//
// `buildCanvasEdges` must therefore drop any edge whose endpoint references a
// hidden group exposed-port handle, so no wire is painted to an unrendered
// handle and the rebuild on a pure move never re-emits the dangling edge.

import { describe, expect, it, beforeEach } from 'vitest'

import { buildCanvasEdges, reconcileCanvasEdges } from '../components/canvas/useCanvasGraphSync.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import type { Battery, ExposedPort, NodeGroup, Pipeline, PipelineEdge } from '../types.js'

const echoBattery: Battery = {
  id: 'demo.echo',
  name: 'Echo',
  type: 'ts',
  category: 'base',
  description: '',
  version: '1.0.0',
  inputs: [{ name: 'value', type: 'any' }, { name: 'scene', type: 'any' }],
  outputs: [{ name: 'output', type: 'any' }],
  params: [],
}

function exposedPort(over: Partial<ExposedPort> & { portName: string; sourceNodeId: string }): ExposedPort {
  return { portType: 'any', sourcePortName: 'value', ...over }
}

/**
 * Build a pipeline with:
 *  - an upstream battery `up`,
 *  - a `__group__` node `grp` exposing inputs `in__pyq3__value` (hidden) and
 *    `in__pyq3__scene` (visible),
 *  - two redirected edges from `up` into those exposed handles.
 */
function pipelineWithHiddenExposedInput(): Pipeline {
  const now = new Date().toISOString()
  const group: NodeGroup = {
    id: 'g1',
    name: 'G',
    nodes: [{ id: 'inner-lpyq3', batteryId: 'demo.echo', name: 'Echo', position: { x: 0, y: 0 }, params: {} }],
    edges: [],
    position: { x: 200, y: 0 },
    exposedInputs: [
      exposedPort({ portName: 'in__pyq3__value', sourceNodeId: 'inner-lpyq3', sourcePortName: 'value', hidden: true }),
      exposedPort({ portName: 'in__pyq3__scene', sourceNodeId: 'inner-lpyq3', sourcePortName: 'scene' }),
    ],
    exposedOutputs: [],
  }
  const edges: PipelineEdge[] = [
    { id: 'e-value_redir', source: { nodeId: 'up', port: 'output' }, target: { nodeId: 'grp', port: 'in__pyq3__value' } },
    { id: 'e-scene_redir', source: { nodeId: 'up', port: 'output' }, target: { nodeId: 'grp', port: 'in__pyq3__scene' } },
  ]
  return {
    id: 'main',
    name: 'main',
    description: '',
    nodes: [
      { id: 'up', batteryId: 'demo.echo', name: 'Up', position: { x: 0, y: 0 }, params: {} },
      { id: 'grp', batteryId: '__group__', name: 'G', position: { x: 200, y: 0 }, params: { groupId: 'g1' } },
    ],
    edges,
    groups: [group],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }
}

beforeEach(() => {
  usePipelineStore.setState({ batteries: [echoBattery], currentPipeline: pipelineWithHiddenExposedInput() })
})

describe('buildCanvasEdges — hidden group exposed-port handles', () => {
  it('drops the redir edge that targets a hidden exposed-port handle, keeps the visible one', () => {
    const built = buildCanvasEdges()
    const ids = built.map((e) => e.id)
    // The hidden port's handle is not rendered → its wire must NOT be emitted
    // (would otherwise produce ReactFlow #008).
    expect(ids).not.toContain('e-value_redir')
    // The visible port's wire is still painted.
    expect(ids).toContain('e-scene_redir')
  })

  it('does not re-emit the dangling edge across a pure-move rebuild (stable identity)', () => {
    const first = buildCanvasEdges()
    // Simulate a pure position move of the unrelated `up` node + a graph re-pull
    // (loadPipeline bumps pipelineRevision and rebuilds edges).
    const moved = pipelineWithHiddenExposedInput()
    moved.nodes = moved.nodes.map((n) => (n.id === 'up' ? { ...n, position: { x: 999, y: 5 } } : n))
    usePipelineStore.setState({ currentPipeline: moved })

    const second = buildCanvasEdges()
    // The dangling edge stays absent on the rebuild — no #008 re-log on drag.
    expect(second.map((e) => e.id)).not.toContain('e-value_redir')
    // Edges are unchanged (moving a node does not touch wiring) → reconcile keeps
    // the previous array identity, so no edge churn / re-render.
    expect(reconcileCanvasEdges(first, second)).toBe(first)
  })

  it('paints the wire once a hidden port is restored', () => {
    const restored = pipelineWithHiddenExposedInput()
    restored.groups = restored.groups!.map((g) => ({
      ...g,
      exposedInputs: g.exposedInputs.map((p) =>
        p.portName === 'in__pyq3__value' ? { ...p, hidden: false } : p,
      ),
    }))
    usePipelineStore.setState({ currentPipeline: restored })
    expect(buildCanvasEdges().map((e) => e.id)).toContain('e-value_redir')
  })
})
