// useCanvasConnect tests — port-type/access resolution and edge cardinality.
//
// Covered: a list-access target port accumulates one edge per referenced item
// (the `[a, b]` construction) instead of replacing the previous wire, and group /
// group_input / group_output boundary handles resolve their real inner port type
// so cross-group wires type-check by the inner tier rather than a flat `any`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Edge, Node } from '../xyflow.js'

import { createMockApiClient } from '../../test/mockApiClient.js'
import { configureEditorTransport, createEditorTransport } from '../transport/index.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useHistoryStore } from '../stores/historyStore.js'
import { createEmptyPipeline } from '../stores/pipelineStore.helpers.js'
import { useCanvasConnect, resolveConnectionPortType } from '../components/canvas/useCanvasConnect.js'
import type { Battery, Pipeline } from '../types.js'

// A dynamic-input sink: `any`-typed tree slots that auto-expand on connect.
const dynamicSinkBattery: Battery = {
  id: 'dyn_sink',
  name: 'DynSink',
  type: 'special',
  category: 'datatree',
  description: '',
  version: '1.0.0',
  inputs: [
    { name: 'item_0', type: 'any', access: 'tree' },
    { name: 'item_1', type: 'any', access: 'tree' },
  ],
  outputs: [{ name: 'tree', type: 'any', access: 'tree' }],
  params: [],
  dynamicInputs: { prefix: 'item_', labelTemplate: '[$i]', minCount: 2, type: 'any', access: 'tree' },
}

// A grid2node-like scene source: its output port carries access:'item'.
const sceneSourceBattery: Battery = {
  id: 'grid2node',
  name: 'Grid2Node',
  type: 'ts',
  category: 'scene',
  description: '',
  version: '1.0.0',
  inputs: [],
  outputs: [{ name: 'scene', type: 'scene', access: 'item' }],
  params: [],
}

function batteryNode(id: string, battery: Battery, params: Record<string, unknown> = {}): Node {
  return {
    id,
    type: 'battery',
    position: { x: 0, y: 0 },
    data: { battery, params },
  }
}

function seedPipeline(): Pipeline {
  const p = createEmptyPipeline()
  p.nodes = [
    { id: 'tm', batteryId: 'dyn_sink', name: 'DynSink', position: { x: 0, y: 0 }, params: {} },
    { id: 's0', batteryId: 'grid2node', name: 'A', position: { x: 0, y: 0 }, params: {} },
    { id: 's1', batteryId: 'grid2node', name: 'B', position: { x: 0, y: 0 }, params: {} },
  ]
  return p
}

beforeEach(() => {
  const client = createMockApiClient({ ops: [] })
  configureEditorTransport(createEditorTransport(client))
  usePipelineStore.setState({
    batteries: [dynamicSinkBattery, sceneSourceBattery, polylineBattery, pointBattery],
    currentPipeline: seedPipeline(),
    selectedNode: null,
    selectedNodeIds: [],
    logs: [],
    nodeOutputs: {},
  })
  useHistoryStore.setState({ entries: [], cursor: 0, _redoTip: null })
})

afterEach(() => {
  usePipelineStore.setState({ currentPipeline: null })
})

function makeHook(nodes: Node[]) {
  let edges: Edge[] = []
  let rfNodes = nodes
  const setEdges = (updater: Edge[] | ((e: Edge[]) => Edge[])) => {
    edges = typeof updater === 'function' ? (updater as (e: Edge[]) => Edge[])(edges) : updater
  }
  const setNodes = (updater: Node[] | ((n: Node[]) => Node[])) => {
    rfNodes = typeof updater === 'function' ? (updater as (n: Node[]) => Node[])(rfNodes) : updater
  }
  const { result } = renderHook(() => useCanvasConnect({ nodes: rfNodes, setEdges, setNodes }))
  return { result, getEdges: () => edges, getNodes: () => rfNodes }
}

const polylineBattery: Battery = {
  id: 'polyline2d',
  name: 'Polyline2d',
  type: 'ts',
  category: 'geometry2d',
  description: '',
  version: '1.0.0',
  inputs: [{ name: 'points', type: 'point2d', access: 'list' }],
  outputs: [{ name: 'geometry', type: 'polyline2d', access: 'item' }],
  params: [],
}

const pointBattery: Battery = {
  id: 'point2d',
  name: 'Point2d',
  type: 'ts',
  category: 'geometry2d',
  description: '',
  version: '1.0.0',
  inputs: [],
  outputs: [{ name: 'geometry', type: 'point2d', access: 'item' }],
  params: [],
}

// Group boundary ports mirror the inner port's real type + access, so cross-group
// wires type-check and colour by the inner tier instead of a flat `any`.
function collapsedGroupNode(id: string): Node {
  return {
    id,
    type: 'group',
    position: { x: 0, y: 0 },
    data: {
      groupId: id,
      groupName: 'G',
      exposedInputs: [{ portName: 'in:x:seed', portType: 'string', access: 'item', sourceNodeId: 'x', sourcePortName: 'seed' }],
      exposedOutputs: [{ portName: 'out:x:scene', portType: 'scene', access: 'item', sourceNodeId: 'x', sourcePortName: 'scene' }],
    },
  }
}

function boundaryNode(id: string, boundaryType: 'input' | 'output'): Node {
  return {
    id,
    type: boundaryType === 'input' ? 'group_input' : 'group_output',
    position: { x: 0, y: 0 },
    data: {
      boundaryType,
      groupId: 'g',
      ports: [{ portName: 'p:scene', portType: 'scene', access: 'item', sourceNodeId: 'x', sourcePortName: 'scene' }],
    },
  }
}

describe('useCanvasConnect — list port construction', () => {
  it('keeps every site wire into points instead of replacing the previous edge', () => {
    const road = batteryNode('road', polylineBattery)
    const origin = batteryNode('origin', pointBattery)
    const plaza = batteryNode('plaza', pointBattery)
    usePipelineStore.setState({
      currentPipeline: {
        ...createEmptyPipeline(),
        nodes: [
          { id: 'road', batteryId: 'polyline2d', name: 'road', position: { x: 0, y: 0 }, params: {} },
          { id: 'origin', batteryId: 'point2d', name: 'origin', position: { x: 0, y: 0 }, params: {} },
          { id: 'plaza', batteryId: 'point2d', name: 'plaza', position: { x: 0, y: 0 }, params: {} },
        ],
      },
    })
    const { result, getEdges } = makeHook([road, origin, plaza])
    act(() => {
      result.current.onConnect({ source: 'origin', sourceHandle: 'geometry', target: 'road', targetHandle: 'points' })
      result.current.onConnect({ source: 'plaza', sourceHandle: 'geometry', target: 'road', targetHandle: 'points' })
    })
    expect(getEdges()).toEqual([
      expect.objectContaining({ source: 'origin', target: 'road', targetHandle: 'points' }),
      expect.objectContaining({ source: 'plaza', target: 'road', targetHandle: 'points' }),
    ])
  })
})

describe('useCanvasConnect — group boundary port resolution', () => {
  it('resolves a collapsed group node output/input port type (not any)', () => {
    const g = collapsedGroupNode('g1')
    expect(resolveConnectionPortType(g, 'out:x:scene', 'source')).toBe('scene')
    expect(resolveConnectionPortType(g, 'in:x:seed', 'target')).toBe('string')
    // Unknown handle → undefined (caller treats as permissive).
    expect(resolveConnectionPortType(g, 'nope', 'source')).toBeUndefined()
  })

  it('resolves inner-view boundary node port type for both source and target handles', () => {
    const gin = boundaryNode('gi', 'input')
    const gout = boundaryNode('go', 'output')
    expect(resolveConnectionPortType(gin, 'p:scene', 'source')).toBe('scene')
    expect(resolveConnectionPortType(gout, 'p:scene', 'target')).toBe('scene')
  })

  it('cross-group wire type-checks by the inner tier (scene→scene ok)', () => {
    const tm = batteryNode('tm', dynamicSinkBattery, { portCount: 2 })
    const g = collapsedGroupNode('g1')
    const { result } = makeHook([tm, g])
    // group output (scene) into an `any` slot → allowed.
    expect(
      result.current.isValidConnection({ source: 'g1', sourceHandle: 'out:x:scene', target: 'tm', targetHandle: 'item_0' }),
    ).toBe(true)
  })
})
