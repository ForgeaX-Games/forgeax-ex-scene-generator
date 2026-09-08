// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { usePipelineStore, type Battery } from '@forgeax/node-runtime-react/editor'
import ImageBatteryNode from '../ImageBatteryNode'

const imageBattery: Battery = {
  id: 'image_resize',
  name: 'Image Resize',
  type: 'ts',
  category: 'image/processing',
  description: 'Resize an image',
  version: '1.0.0',
  inputs: [{ name: 'image', type: 'image' }],
  outputs: [{ name: 'image', type: 'image' }],
  params: [],
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as CanvasRenderingContext2D)
  usePipelineStore.setState({
    currentPipeline: {
      id: 'p1',
      name: 'test',
      description: '',
      nodes: [{ id: 'n1', batteryId: 'image_resize', name: 'Image Resize', position: { x: 0, y: 0 }, params: {} }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    nodeOutputs: {
      n1: {
        image: JSON.stringify({ alias: 'tile.png', blobId: 'abc123' }),
      },
    },
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  usePipelineStore.setState({ currentPipeline: null, nodeOutputs: {} })
})

describe('ImageBatteryNode', () => {
  it('renders output image thumbnails using the app blob route', () => {
    const { container } = render(
      <ReactFlowProvider>
        <ImageBatteryNode
          id="n1"
          type="asset2d_image_battery"
          selected={false}
          selectable
          deletable
          draggable
          dragging={false}
          zIndex={0}
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          data={{ battery: imageBattery, params: {} }}
        />
      </ReactFlowProvider>,
    )

    const preview = container.querySelector<HTMLImageElement>('.asset2d-image-preview__img')
    expect(preview).not.toBeNull()
    expect(preview?.getAttribute('src')).toBe('/api/v1/library/blob/abc123')
    expect(container.querySelector('.asset2d-image-preview__caption')?.textContent).toContain('image')
  })
})
