import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'

import AINode from '../components/canvas/AINode.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import type { Battery, Pipeline } from '../types.js'

const imageBattery: Battery = {
  id: 'image_gen',
  name: 'Image Gen',
  nameEn: 'Image Gen',
  type: 'ai',
  category: 'ai',
  description: 'Generate an image',
  version: '1.0.0',
  inputs: [
    { name: 'prompt', type: 'string' },
    { name: 'image', type: 'image' },
  ],
  outputs: [
    { name: 'image', type: 'image' },
    { name: 'error', type: 'string' },
  ],
  params: [],
}

function pipelineWithPromptEdge(): Pipeline {
  const now = new Date().toISOString()
  return {
    id: 'p-ai',
    name: 'ai',
    description: '',
    nodes: [
      { id: 'panel-1', batteryId: 'text_panel', name: 'Panel', position: { x: 0, y: 0 }, params: {} },
      { id: 'image-1', batteryId: 'image_gen', name: 'Image Gen', position: { x: 100, y: 0 }, params: {} },
    ],
    edges: [
      {
        id: 'e-panel-image',
        source: { nodeId: 'panel-1', port: 'output' },
        target: { nodeId: 'image-1', port: 'prompt' },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }
}

describe('AINode', () => {
  beforeEach(() => {
    usePipelineStore.setState({
      batteries: [imageBattery],
      categories: [],
      currentPipeline: pipelineWithPromptEdge(),
      sessionRestorePending: null,
      pipelineStatus: 'idle',
      selectedNode: null,
      selectedNodeIds: [],
      logs: [],
      nodeOutputs: {
        'panel-1': {
          output: [{ path: [0], items: ['一只可爱的小猫'] }],
        },
      },
      dynamicOutputPorts: {},
      groupViewStack: [],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends the text item from an upstream panel wire value as the image prompt', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: { image: '{"alias":"generated/cat.png"}' } }),
    } as Response)

    render(
      <ReactFlowProvider>
        <AINode
          id="image-1"
          data={{ battery: imageBattery, params: {} }}
          selected={false}
          dragging={false}
        />
      </ReactFlowProvider>,
    )

    fireEvent.click(document.querySelector('.ai-run-btn') as HTMLButtonElement)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(init?.body)).prompt).toBe('一只可爱的小猫')
  })
})
