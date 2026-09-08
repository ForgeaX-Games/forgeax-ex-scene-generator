// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { usePipelineStore, type Battery } from '@forgeax/node-runtime-react/editor'
import ImageSourceNode from '../ImageSourceNode'

const sourceBattery: Battery = {
  id: 'image_source',
  name: '图像源',
  type: 'ts',
  category: 'image/basic',
  description: 'Emit a library image as a source',
  version: '1.0.0',
  nodeType: 'image_source',
  inputs: [],
  outputs: [{ name: 'image', type: 'image' }],
  params: [],
}

function seedStore(image: string): void {
  usePipelineStore.setState({
    currentPipeline: {
      id: 'p1',
      name: 'test',
      description: '',
      nodes: [{ id: 'src', batteryId: 'image_source', name: '图像源', position: { x: 0, y: 0 }, params: { image } }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    nodeOutputs: {},
  })
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as CanvasRenderingContext2D)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  usePipelineStore.setState({ currentPipeline: null, nodeOutputs: {} })
})

function renderNode(): HTMLElement {
  // `data.params` is intentionally stale/empty: the node must read its image from
  // the live store, not this snapshot (that is the in-place-replace lag fix).
  const { container } = render(
    <ReactFlowProvider>
      <ImageSourceNode
        id="src"
        type="image_source"
        selected={false}
        selectable
        deletable
        draggable
        dragging={false}
        zIndex={0}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{ battery: sourceBattery, params: {} }}
      />
    </ReactFlowProvider>,
  )
  return container
}

describe('ImageSourceNode', () => {
  it('previews the image from the live store even when the ReactFlow data is stale', () => {
    seedStore(JSON.stringify({ alias: 'a.png', blobId: 'aaa' }))
    const container = renderNode()
    const img = container.querySelector<HTMLImageElement>('.is-preview__img')
    expect(img?.getAttribute('src')).toBe('/api/v1/library/blob/aaa')
  })

  it('updates the preview synchronously when the live param changes (in-place replace)', () => {
    seedStore(JSON.stringify({ alias: 'a.png', blobId: 'aaa' }))
    const container = renderNode()
    expect(container.querySelector<HTMLImageElement>('.is-preview__img')?.getAttribute('src')).toBe(
      '/api/v1/library/blob/aaa',
    )
    act(() => {
      usePipelineStore.getState().updateNodeParam('src', 'image', JSON.stringify({ alias: 'b.png', blobId: 'bbb' }), true)
    })
    expect(container.querySelector<HTMLImageElement>('.is-preview__img')?.getAttribute('src')).toBe(
      '/api/v1/library/blob/bbb',
    )
  })
})
