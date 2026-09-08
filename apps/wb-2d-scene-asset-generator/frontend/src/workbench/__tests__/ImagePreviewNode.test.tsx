// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { usePipelineStore, type Battery } from '@forgeax/node-runtime-react/editor'
import ImagePreviewNode from '../ImagePreviewNode'

const previewBattery: Battery = {
  id: 'image_preview',
  name: '图像预览',
  type: 'ts',
  category: 'image/basic',
  description: 'Preview an upstream image',
  version: '1.0.0',
  nodeType: 'image_preview',
  inputs: [{ name: 'image', type: 'image' }],
  outputs: [{ name: 'image', type: 'image' }],
  params: [],
}

function seedStore(opts: { withEdge: boolean }): void {
  usePipelineStore.setState({
    currentPipeline: {
      id: 'p1',
      name: 'test',
      description: '',
      nodes: [
        { id: 'src', batteryId: 'image_reader', name: 'Reader', position: { x: 0, y: 0 }, params: {} },
        { id: 'prev', batteryId: 'image_preview', name: '图像预览', position: { x: 200, y: 0 }, params: {} },
      ],
      edges: opts.withEdge
        ? [{ id: 'e1', source: { nodeId: 'src', port: 'image' }, target: { nodeId: 'prev', port: 'image' } }]
        : [],
      viewport: { x: 0, y: 0, zoom: 1 },
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    nodeOutputs: {
      src: { image: JSON.stringify({ alias: 'tile.png', blobId: 'abc123' }) },
    },
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
  const { container } = render(
    <ReactFlowProvider>
      <ImagePreviewNode
        id="prev"
        type="image_preview"
        selected={false}
        selectable
        deletable
        draggable
        dragging={false}
        zIndex={0}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        data={{ battery: previewBattery, params: {} }}
      />
    </ReactFlowProvider>,
  )
  return container
}

describe('ImagePreviewNode', () => {
  it('previews the upstream image resolved from the incoming edge', () => {
    seedStore({ withEdge: true })
    const container = renderNode()
    const img = container.querySelector<HTMLImageElement>('.ip-preview__img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('/api/v1/library/blob/abc123')
  })

  it('renders one thumbnail per image when the input carries multiple images', () => {
    seedStore({ withEdge: true })
    usePipelineStore.setState({
      nodeOutputs: {
        src: {
          image: [
            JSON.stringify({ alias: 'a.png', blobId: 'aaa' }),
            JSON.stringify({ alias: 'b.png', blobId: 'bbb' }),
          ],
        },
      },
    })
    const container = renderNode()
    const imgs = container.querySelectorAll<HTMLImageElement>('.ip-preview__img')
    expect(imgs).toHaveLength(2)
    expect(imgs[0].getAttribute('src')).toBe('/api/v1/library/blob/aaa')
    expect(imgs[1].getAttribute('src')).toBe('/api/v1/library/blob/bbb')
  })

  it('shows the empty-state hint when no image is connected', () => {
    seedStore({ withEdge: false })
    const container = renderNode()
    expect(container.querySelector('.ip-preview__img')).toBeNull()
    expect(container.querySelector('.ip-preview__hint')?.textContent).toContain('连接图像端口')
  })
})
