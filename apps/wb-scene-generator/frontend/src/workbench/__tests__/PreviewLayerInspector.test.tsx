// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useAssetStoreStore } from '../../surfaces/library/assetStoreStore.js'
import type { SelectedLayerSnapshot } from '../../surfaces/library/layerInspector.js'
import { PreviewControlsPanel } from '../PreviewControlsPanel.js'
import { PreviewLayerInspector } from '../PreviewLayerInspector.js'

const EDITABLE_PREVIEW_CONTEXT = {
  editMode: true,
  viewMode: 'topBillboard',
  drawMode: 'asset',
  editAvailable: true,
}

function layer(overrides?: Partial<SelectedLayerSnapshot>): SelectedLayerSnapshot {
  return {
    kind: 'baked',
    layerKey: 'baked:/Floor',
    nodePath: '/Floor',
    nodeName: 'Floor',
    value: 1,
    assetName: '草地',
    assetType: 'tile',
    attributes: { asset_name: '草地', asset_type: 'tile' },
    voxelStats: { cellCount: 1, xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0, tokenCount: 0 },
    ...overrides,
  }
}

beforeEach(() => {
  useAssetStoreStore.setState({
    assets: [],
    total: 0,
    selected: null,
    loading: false,
  })
})

afterEach(() => cleanup())

describe('PreviewLayerInspector', () => {
  it('renders Preview controls with Scene Generator panel chrome', () => {
    render(
      <PreviewControlsPanel
        editMode
        editTool="paint"
        brushMode="free"
        editZ={1}
        previewContext={EDITABLE_PREVIEW_CONTEXT}
        bakedHistory={{ canUndo: false, canRedo: false, entries: [] }}
        selectedLayers={[]}
        onPickTool={vi.fn()}
        onPickBrush={vi.fn()}
        onUpdateEditZ={vi.fn()}
        onUndoBakedEdit={vi.fn()}
        onRedoBakedEdit={vi.fn()}
        screenshot={{ status: 'idle' }}
        onCaptureScreenshot={vi.fn()}
        onDismissScreenshot={vi.fn()}
      />,
    )

    const panel = document.querySelector('.editor-controls-panel')
    expect(panel).toBeTruthy()
    expect(screen.getByRole('button', { name: /edit tools/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /selected layer/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /help/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /paint/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /eraser/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /eyedropper/i })).toBeTruthy()
    expect((screen.getByRole('button', { name: /undo/i }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /redo/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Free brush')).toBeTruthy()
    expect(screen.getByText(/Select a layer in the Preview panel/i)).toBeTruthy()
  })

  it('calls baked undo and redo handlers when history is available', () => {
    const onUndoBakedEdit = vi.fn()
    const onRedoBakedEdit = vi.fn()
    render(
      <PreviewControlsPanel
        editMode
        editTool="erase"
        brushMode="free"
        editZ={1}
        previewContext={EDITABLE_PREVIEW_CONTEXT}
        bakedHistory={{
          canUndo: true,
          canRedo: true,
          undoLabel: 'Paint baked layer',
          redoLabel: 'Erase baked layer',
          entries: [{ id: 'h1', label: 'Paint baked layer', tool: 'paint', createdAt: '2026-06-04T00:00:00.000Z', summary: { paths: ['/Layer'] } }],
        }}
        selectedLayers={[]}
        onPickTool={vi.fn()}
        onPickBrush={vi.fn()}
        onUpdateEditZ={vi.fn()}
        onUndoBakedEdit={onUndoBakedEdit}
        onRedoBakedEdit={onRedoBakedEdit}
        screenshot={{ status: 'idle' }}
        onCaptureScreenshot={vi.fn()}
        onDismissScreenshot={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /undo/i }))
    fireEvent.click(screen.getByRole('button', { name: /redo/i }))

    expect(onUndoBakedEdit).toHaveBeenCalledTimes(1)
    expect(onRedoBakedEdit).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Paint baked layer')).toBeTruthy()
  })

  it('collapses and expands Preview sections', () => {
    render(
      <PreviewControlsPanel
        editMode
        editTool="paint"
        brushMode="free"
        editZ={0}
        previewContext={EDITABLE_PREVIEW_CONTEXT}
        bakedHistory={{ canUndo: false, canRedo: false, entries: [] }}
        selectedLayers={[]}
        onPickTool={vi.fn()}
        onPickBrush={vi.fn()}
        onUpdateEditZ={vi.fn()}
        onUndoBakedEdit={vi.fn()}
        onRedoBakedEdit={vi.fn()}
        screenshot={{ status: 'idle' }}
        onCaptureScreenshot={vi.fn()}
        onDismissScreenshot={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /selected layer/i }))
    expect(screen.queryByText(/Select a layer in the Preview panel/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /selected layer/i }))
    expect(screen.getByText(/Select a layer in the Preview panel/i)).toBeTruthy()
  })

  it('shows a matched asset thumbnail for the selected baked layer', () => {
    useAssetStoreStore.setState({
      assets: [{
        id: 'a1',
        alias: '[]_[]_[草地]_[]_[]_[风格]_[正常]_[抠图]_[16]_[静态]_[]_[0]_[]',
        zone: 'raw',
        blobSha256: 's',
        mimeType: 'image/png',
        sizeBytes: 10,
        anchorX: null,
        anchorY: null,
      }],
      total: 1,
    })

    const { container, getByText } = render(<PreviewLayerInspector layers={[layer()]} />)
    expect(getByText('Matched asset')).toBeTruthy()
    expect(container.querySelector('.scene-left-pane__asset-preview img')?.getAttribute('src')).toContain('/api/v1/library/serve/')
  })

  it('uses the selected-layer snapshot alias when the left pane asset list is not loaded', () => {
    const alias = '[]_[]_[草地]_[]_[]_[风格]_[正常]_[抠图]_[16]_[静态]_[]_[0]_[]'

    const { container, getByText, queryByText } = render(<PreviewLayerInspector layers={[layer({ assetAlias: alias })]} />)

    expect(getByText('Matched asset')).toBeTruthy()
    expect(queryByText('Asset not found in library')).toBeNull()
    expect(container.querySelector('.scene-left-pane__asset-preview img')?.getAttribute('src')).toContain(encodeURIComponent(alias))
  })

  it('shows an explicit fallback when the layer has no bound asset', () => {
    const { getByText } = render(<PreviewLayerInspector layers={[layer({ assetName: '', attributes: {} })]} />)
    expect(getByText('No bound asset')).toBeTruthy()
  })

  it('shows an explicit fallback when a loaded library list does not contain the bound asset', () => {
    useAssetStoreStore.setState({
      assets: [{
        id: 'a1',
        alias: '[]_[]_[石头]_[]_[]_[风格]_[正常]_[抠图]_[16]_[静态]_[]_[0]_[]',
        zone: 'raw',
        blobSha256: 's',
        mimeType: 'image/png',
        sizeBytes: 10,
        anchorX: null,
        anchorY: null,
      }],
      total: 1,
    })

    const { getByText } = render(<PreviewLayerInspector layers={[layer()]} />)
    expect(getByText('Asset not found in library')).toBeTruthy()
  })
})
