// BatteryBar rail scroll layout — category buttons scroll independently while the
// collection controls (collapse / mode toggle / favorites) stay pinned at the bottom.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import { createMockApiClient } from '../../test/mockApiClient.js'
import { configureEditorTransport, createEditorTransport, type EditorTransport } from '../transport/index.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useHistoryStore } from '../stores/historyStore.js'
import BatteryBar from '../components/sidebar/BatteryBar.js'
import type { Battery, Pipeline } from '../types.js'

function makeBattery(index: number): Battery {
  const big = `scene${index}`
  return {
    id: `demo.${big}`,
    name: `Battery ${index}`,
    nameEn: `Battery ${index}`,
    type: 'ts',
    category: `${big}/general`,
    description: '',
    version: '1.0.0',
    inputs: [],
    outputs: [],
    params: [],
  }
}

function seededPipeline(): Pipeline {
  const now = new Date().toISOString()
  return {
    id: 'p-rail',
    name: 'rail',
    description: '',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }
}

let transport: EditorTransport

beforeEach(() => {
  const client = createMockApiClient({ ops: [] })
  transport = createEditorTransport(client)
  configureEditorTransport(transport)
  useHistoryStore.setState({ entries: [], cursor: 0, _redoTip: null })
})

afterEach(() => {
  transport.dispose()
  configureEditorTransport(null)
})

describe('BatteryBar rail scroll layout', () => {
  it('wraps battery categories in an independently scrollable region', () => {
    usePipelineStore.setState({
      batteries: [makeBattery(1)],
      categories: [],
      batteryOrder: { bigLabels: [], smallLabels: {} },
      currentPipeline: seededPipeline(),
      sessionRestorePending: null,
      pipelineStatus: 'idle',
      selectedNode: null,
      selectedNodeIds: [],
      logs: [],
      compileInfo: null,
      nodeOutputs: {},
      dynamicOutputPorts: {},
      groupViewStack: [],
    })

    const { container } = render(<BatteryBar />)
    const rail = container.querySelector('.bb-big-rail')
    const scrollRegion = container.querySelector('.bb-rail-scroll-region')
    const batteriesGroup = container.querySelector('.bb-rail-group--batteries')
    const collectionGroup = container.querySelector('.bb-rail-group--collection')

    expect(rail).not.toBeNull()
    expect(scrollRegion).not.toBeNull()
    expect(batteriesGroup).not.toBeNull()
    expect(collectionGroup).not.toBeNull()
    expect(scrollRegion?.contains(batteriesGroup)).toBe(true)
    expect(scrollRegion?.contains(collectionGroup)).toBe(false)
    expect(rail?.contains(collectionGroup)).toBe(true)
  })

  it('renders one rail button per non-collection big label inside the scroll region', () => {
    const batteries = Array.from({ length: 8 }, (_, i) => makeBattery(i + 1))
    usePipelineStore.setState({
      batteries,
      categories: [],
      batteryOrder: { bigLabels: [], smallLabels: {} },
      currentPipeline: seededPipeline(),
      sessionRestorePending: null,
      pipelineStatus: 'idle',
      selectedNode: null,
      selectedNodeIds: [],
      logs: [],
      compileInfo: null,
      nodeOutputs: {},
      dynamicOutputPorts: {},
      groupViewStack: [],
    })

    const { container } = render(<BatteryBar />)
    const batteriesGroup = container.querySelector('.bb-rail-group--batteries')
    const railButtons = batteriesGroup?.querySelectorAll('.bb-rail-button') ?? []

    // Eight distinct big tags; favorites/presets are absent from this seed.
    expect(railButtons.length).toBe(8)
  })

  it('keeps collection controls outside the scroll region', () => {
    usePipelineStore.setState({
      batteries: [makeBattery(1)],
      categories: [],
      batteryOrder: { bigLabels: [], smallLabels: {} },
      currentPipeline: seededPipeline(),
      sessionRestorePending: null,
      pipelineStatus: 'idle',
      selectedNode: null,
      selectedNodeIds: [],
      logs: [],
      compileInfo: null,
      nodeOutputs: {},
      dynamicOutputPorts: {},
      groupViewStack: [],
    })

    const { container } = render(<BatteryBar />)
    const collectionGroup = container.querySelector('.bb-rail-group--collection')

    expect(collectionGroup?.querySelector('.bb-rail-button--collapse')).not.toBeNull()
    expect(collectionGroup?.querySelector('.bb-rail-button--mode')).not.toBeNull()
  })
})
