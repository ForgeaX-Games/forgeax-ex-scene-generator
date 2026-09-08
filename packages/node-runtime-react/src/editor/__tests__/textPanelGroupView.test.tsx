// A Panel wired inside a group's inner view is upstream-driven: its wiring lives
// in the group's edge table, so reading only the root pipeline edges made it
// render the (empty) local text placeholder instead of the upstream grid.
import { beforeEach, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'

import TextPanelNode from '../components/canvas/TextPanelNode.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import type { Battery, Pipeline } from '../types.js'

const panelBattery: Battery = {
  id: 'text_panel',
  name: '文本面板',
  nameEn: 'Panel',
  type: 'input',
  category: 'input',
  description: '',
  version: '1.0.0',
  inputs: [{ name: 'input', type: 'any' }],
  outputs: [{ name: 'output', type: 'string' }],
  params: [],
}

function pipelineWithGroupedPanel(): Pipeline {
  const now = new Date().toISOString()
  return {
    id: 'p-group',
    name: 'group',
    description: '',
    nodes: [],
    edges: [],
    groups: [
      {
        id: 'g-1',
        name: 'G',
        nodes: [
          { id: 'grid-1', batteryId: 'rect_grid', name: 'Grid', position: { x: 0, y: 0 }, params: {} },
          { id: 'panel-1', batteryId: 'text_panel', name: 'Panel', position: { x: 200, y: 0 }, params: {} },
        ],
        edges: [
          {
            id: 'e-grid-panel',
            source: { nodeId: 'grid-1', port: 'grid' },
            target: { nodeId: 'panel-1', port: 'input' },
          },
        ],
        exposedInputs: [],
        exposedOutputs: [],
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  } as Pipeline
}

function renderPanel() {
  return render(
    <ReactFlowProvider>
      <TextPanelNode
        id="panel-1"
        data={{ battery: panelBattery, params: {} }}
        selected={false}
        dragging={false}
      />
    </ReactFlowProvider>,
  )
}

describe('TextPanelNode inside a group view', () => {
  beforeEach(() => {
    usePipelineStore.setState({
      batteries: [panelBattery],
      categories: [],
      currentPipeline: pipelineWithGroupedPanel(),
      sessionRestorePending: null,
      pipelineStatus: 'idle',
      selectedNode: null,
      selectedNodeIds: [],
      logs: [],
      nodeOutputs: {},
      dynamicOutputPorts: {},
      groupViewStack: ['g-1'],
    })
  })

  it('renders its own hydrated output', () => {
    usePipelineStore.setState({
      nodeOutputs: { 'panel-1': { output: [{ path: [0], items: ['[[0,1],[1,0]]'] }] } },
    })
    const { container } = renderPanel()
    expect(container.textContent).toContain('[[0,1],[1,0]]')
    expect(container.querySelector('.text-panel-placeholder')).toBeNull()
  })

  it('falls back to the upstream value before its own output is hydrated', () => {
    usePipelineStore.setState({
      nodeOutputs: { 'grid-1': { grid: [{ path: [0], items: [[[0, 1], [1, 0]]] }] } },
    })
    const { container } = renderPanel()
    expect(container.textContent).toContain('[0,1]')
    expect(container.querySelector('.text-panel-placeholder')).toBeNull()
  })
})
