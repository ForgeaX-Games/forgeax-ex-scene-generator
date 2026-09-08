// @vitest-environment jsdom
import { forwardRef, useImperativeHandle } from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { RenderCanvas } from '../RenderCanvas'
import { useRenderStore } from '../../store'
import { registerRenderPlugin, type PluginHandle } from '../../framework/plugin'
import { readPaintAsset, writePaintAsset } from '../../../surfaces/library/paintAssetBus'
import { bakedApi } from '../../bridge/bakedApi'
import type { AliasMeta } from '../../framework/asset/matchAssetEntry'

vi.mock('../../bridge/bakedApi', () => ({
  bakedApi: {
    list: vi.fn().mockResolvedValue([]),
    setCells: vi.fn().mockResolvedValue(undefined),
    history: vi.fn().mockResolvedValue({ canUndo: false, canRedo: false, entries: [] }),
    undo: vi.fn().mockResolvedValue({ canUndo: false, canRedo: true, entries: [] }),
    redo: vi.fn().mockResolvedValue({ canUndo: true, canRedo: false, entries: [] }),
  },
}))

const DragTestPlugin = forwardRef<PluginHandle, object>(function DragTestPlugin(_, ref) {
  useImperativeHandle(ref, () => ({
    screenToCell: (cssX, cssY) => ({ col: Math.floor(cssX / 10), row: Math.floor(cssY / 10) }),
    screenToEditCell: (cssX, cssY, z) => ({ x: Math.floor(cssX / 10), y: Math.floor(cssY / 10), z }),
  }))
  return <div data-testid="drag-test-plugin" />
})

registerRenderPlugin({
  name: 'drag-test',
  modes: ['topBillboard'],
  Component: DragTestPlugin,
})

beforeEach(() => {
  localStorage.clear()
  useRenderStore.getState().reset()
  vi.mocked(bakedApi.list).mockReset()
  vi.mocked(bakedApi.list).mockResolvedValue([])
  vi.mocked(bakedApi.setCells).mockReset()
  vi.mocked(bakedApi.setCells).mockResolvedValue(undefined)
  vi.mocked(bakedApi.undo).mockReset()
  vi.mocked(bakedApi.undo).mockResolvedValue({ canUndo: false, canRedo: true, entries: [] })
  vi.mocked(bakedApi.redo).mockReset()
  vi.mocked(bakedApi.redo).mockResolvedValue({ canUndo: true, canRedo: false, entries: [] })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function installRafQueue(): () => void {
  const callbacks: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
    callbacks.push(cb)
    return callbacks.length
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  return () => {
    const pending = callbacks.splice(0)
    for (const cb of pending) cb(performance.now())
  }
}

function enableEditPainting(brushMode: 'free' | 'box' = 'free'): void {
  const store = useRenderStore.getState()
  store.setViewMode('topBillboard')
  store.setDrawMode('asset')
  store.setEditMode(true)
  store.setBrushMode(brushMode)
  store.setBakedLayers([
    {
      nodePath: '/Layer',
      nodeName: 'Layer',
      value: 1,
      assetName: 'grass',
      assetType: 'tile',
      cells: [],
    },
  ])
  store.setActiveBakedLayer('baked:/Layer')
  writePaintAsset({ alias: 'grass', name: 'grass', type: 'tile' })
}

function enableEditPaintingForAsset(
  asset: { alias: string; name: string; type: 'tile' | 'asset' },
  aliasMetas: AliasMeta[],
  brushMode: 'free' | 'box' = 'free',
): void {
  const store = useRenderStore.getState()
  store.setViewMode('topBillboard')
  store.setDrawMode('asset')
  store.setEditMode(true)
  store.setBrushMode(brushMode)
  store.setAliasMetas(aliasMetas)
  store.setBakedLayers([
    {
      nodePath: '/Layer',
      nodeName: 'Layer',
      value: 1,
      assetName: asset.name,
      assetType: asset.type === 'tile' ? 'tile' : 'object',
      assetAlias: asset.alias,
      cells: [],
    },
  ])
  store.setActiveBakedLayer('baked:/Layer')
  writePaintAsset(asset)
}

describe('RenderCanvas host', () => {
  it('shows a no-plugin notice when no mode is registered', () => {
    // All four real modes now register plugins; cast a bogus mode to exercise the no-plugin path.
    useRenderStore.setState({ viewMode: '__none__' as never })
    const { container } = render(<RenderCanvas />)
    expect(container.querySelector('[data-status="no-plugin"]')).not.toBeNull()
  })

  it('keeps edit hover on the current cell during free-brush drag', () => {
    const flushRaf = installRafQueue()
    enableEditPainting('free')
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseMove(host, { clientX: 12, clientY: 22 })
    fireEvent.mouseDown(host, { button: 0, clientX: 12, clientY: 22 })
    fireEvent.mouseMove(host, { clientX: 34, clientY: 45 })
    flushRaf()

    expect(useRenderStore.getState().editHoverCell).toEqual({ x: 3, y: 4, z: 0 })
    expect(useRenderStore.getState().bakedLayers['baked:/Layer']?.cells).toEqual([
      { x: 1, y: 2, z: 0 },
      { x: 3, y: 4, z: 0 },
    ])
  })

  it('keeps edit hover on the current cell during box drag', () => {
    enableEditPainting('box')
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseMove(host, { clientX: 12, clientY: 22 })
    fireEvent.mouseDown(host, { button: 0, clientX: 12, clientY: 22 })
    fireEvent.mouseMove(host, { clientX: 34, clientY: 45 })

    expect(useRenderStore.getState().editHoverCell).toEqual({ x: 3, y: 4, z: 0 })
    expect(useRenderStore.getState().editBox).toEqual({ x0: 1, y0: 2, x1: 3, y1: 4, z: 0 })
  })

  it('paints non-tile object assets as one shared-instance column batch', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234)
    enableEditPaintingForAsset(
      { alias: 'tree-alias', name: 'Tree', type: 'asset' },
      [{
        alias: 'tree-alias',
        anchorX: 0.5,
        anchorY: 0,
        widthPx: 48,
        heightPx: 64,
        ppu: 16,
        objectHeightPx: 33,
        geometry: {
          collisionMask: { kind: 'rectangle', x: 4, y: 16, width: 32, height: 30 },
        },
      }],
    )
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseDown(host, { button: 0, clientX: 102, clientY: 204 })
    fireEvent.mouseUp(host)

    const savedCells = vi.mocked(bakedApi.setCells).mock.calls.at(-1)?.[1] ?? []
    expect(savedCells).toHaveLength(12)
    expect(new Set(savedCells.map((c) => c.state?.instanceId)).size).toBe(1)
    expect(savedCells.filter((c) => c.state?.role === 'anchor')).toHaveLength(1)
    expect(savedCells.every((c) => c.token === 'Tree')).toBe(true)
    expect(savedCells.some((c) => c.state?.columnDz === 2)).toBe(true)
    expect(vi.mocked(bakedApi.setCells).mock.calls.at(-1)?.[2]).toEqual({
      name: 'Tree',
      type: 'object',
      alias: 'tree-alias',
    })
  })

  it('paints object footprints using the collision mask offset relative to the anchor', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234)
    enableEditPaintingForAsset(
      { alias: 'hospital-alias', name: 'Hospital', type: 'asset' },
      [{
        alias: 'hospital-alias',
        anchorX: 0.4871605103,
        anchorY: 0.2480118615,
        widthPx: 455,
        heightPx: 453,
        ppu: 16,
        objectHeightPx: 16,
        geometry: {
          collisionMask: { kind: 'rectangle', x: 3.54, y: 1.52, width: 436.24, height: 221.65 },
        },
      }],
    )
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseDown(host, { button: 0, clientX: 1002, clientY: 2004 })
    fireEvent.mouseUp(host)

    const savedCells = vi.mocked(bakedApi.setCells).mock.calls.at(-1)?.[1] ?? []
    expect(savedCells).toHaveLength(27 * 14)
    expect(savedCells[0]?.state?.footprintOrigin).toEqual({ x: 87, y: 193, z: 0 })
    expect(savedCells.find((c) => c.state?.role === 'anchor')).toMatchObject({
      x: 100,
      y: 200,
      z: 0,
    })
  })

  it('aligns tile hover and free-brush placement to the rendered top face', () => {
    const flushRaf = installRafQueue()
    enableEditPaintingForAsset(
      { alias: 'grass-alias', name: 'Grass', type: 'tile' },
      [{ alias: 'grass-alias', tileType: 'common_16' }],
    )
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseMove(host, { clientX: 102, clientY: 204 })
    fireEvent.mouseDown(host, { button: 0, clientX: 102, clientY: 204 })
    flushRaf()
    fireEvent.mouseUp(host)

    expect(useRenderStore.getState().editHoverCell).toEqual({ x: 10, y: 21, z: 0 })
    expect(vi.mocked(bakedApi.setCells).mock.calls.at(-1)?.[1]).toEqual([
      { x: 10, y: 21, z: 0, token: 'Grass' },
    ])
    expect(vi.mocked(bakedApi.setCells).mock.calls.at(-1)?.[2]).toEqual({
      name: 'Grass',
      type: 'tile',
      alias: 'grass-alias',
    })
  })

  it('coalesces tile drag painting into one layer rewrite per animation frame', async () => {
    const flushRaf = installRafQueue()
    enableEditPaintingForAsset(
      { alias: 'grass-alias', name: 'Grass', type: 'tile' },
      [{ alias: 'grass-alias', tileType: 'common_16' }],
    )
    let layerUpdates = 0
    let prevLayer = useRenderStore.getState().bakedLayers['baked:/Layer']
    const unsubscribe = useRenderStore.subscribe((state) => {
      const nextLayer = state.bakedLayers['baked:/Layer']
      if (nextLayer !== prevLayer) {
        layerUpdates++
        prevLayer = nextLayer
      }
    })
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseDown(host, { button: 0, clientX: 102, clientY: 204 })
    fireEvent.mouseMove(host, { clientX: 112, clientY: 204 })
    fireEvent.mouseMove(host, { clientX: 122, clientY: 204 })
    fireEvent.mouseMove(host, { clientX: 132, clientY: 204 })
    expect(layerUpdates).toBe(1)

    flushRaf()
    expect(layerUpdates).toBe(2)
    expect(useRenderStore.getState().bakedLayers['baked:/Layer']?.cells).toEqual([
      { x: 10, y: 21, z: 0 },
      { x: 11, y: 21, z: 0 },
      { x: 12, y: 21, z: 0 },
      { x: 13, y: 21, z: 0 },
    ])

    fireEvent.mouseUp(host)
    await waitFor(() => expect(bakedApi.setCells).toHaveBeenCalledTimes(1))
    unsubscribe()
  })

  it('writes the first free-brush tile cell to the local store synchronously', () => {
    installRafQueue()
    enableEditPaintingForAsset(
      { alias: 'grass-alias', name: 'Grass', type: 'tile' },
      [{ alias: 'grass-alias', tileType: 'common_16' }],
    )
    useRenderStore.getState().bindBakedLayerAsset('baked:/Layer', 'Grass', 'tile', 'grass-alias')
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseDown(host, { button: 0, clientX: 102, clientY: 204 })

    expect(useRenderStore.getState().bakedLayers['baked:/Layer']?.cells).toEqual([
      { x: 10, y: 21, z: 0 },
    ])
    expect(bakedApi.setCells).not.toHaveBeenCalled()
  })

  it('flushes pending tile drag cells before persisting on mouseup', async () => {
    installRafQueue()
    enableEditPaintingForAsset(
      { alias: 'grass-alias', name: 'Grass', type: 'tile' },
      [{ alias: 'grass-alias', tileType: 'common_16' }],
    )
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseDown(host, { button: 0, clientX: 102, clientY: 204 })
    fireEvent.mouseMove(host, { clientX: 112, clientY: 204 })
    fireEvent.mouseMove(host, { clientX: 122, clientY: 204 })
    fireEvent.mouseMove(host, { clientX: 132, clientY: 204 })
    fireEvent.mouseUp(host)

    await waitFor(() => expect(bakedApi.setCells).toHaveBeenCalledTimes(1))
    expect(vi.mocked(bakedApi.setCells).mock.calls.at(-1)?.[1]).toEqual([
      { x: 10, y: 21, z: 0, token: 'Grass' },
      { x: 11, y: 21, z: 0, token: 'Grass' },
      { x: 12, y: 21, z: 0, token: 'Grass' },
      { x: 13, y: 21, z: 0, token: 'Grass' },
    ])
  })

  it('does not let a stale baked refresh erase optimistic tile drag cells before mouseup', async () => {
    const flushRaf = installRafQueue()
    enableEditPaintingForAsset(
      { alias: 'grass-alias', name: 'Grass', type: 'tile' },
      [{ alias: 'grass-alias', tileType: 'common_16' }],
    )
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseDown(host, { button: 0, clientX: 102, clientY: 204 })
    fireEvent.mouseMove(host, { clientX: 112, clientY: 204 })
    fireEvent.mouseMove(host, { clientX: 122, clientY: 204 })
    flushRaf()

    useRenderStore.getState().setBakedLayers([
      {
        nodePath: '/Layer',
        nodeName: 'Layer',
        value: 1,
        assetName: 'Grass',
        assetType: 'tile',
        version: 1,
        cells: [],
      },
    ])
    fireEvent.mouseMove(host, { clientX: 132, clientY: 204 })
    fireEvent.mouseUp(host)

    await waitFor(() => expect(bakedApi.setCells).toHaveBeenCalledTimes(1))
    expect(vi.mocked(bakedApi.setCells).mock.calls.at(-1)?.[1]).toEqual([
      { x: 10, y: 21, z: 0, token: 'Grass' },
      { x: 11, y: 21, z: 0, token: 'Grass' },
      { x: 12, y: 21, z: 0, token: 'Grass' },
      { x: 13, y: 21, z: 0, token: 'Grass' },
    ])
  })

  it('does not rewrite the layer for duplicate tile cells within a drag frame', () => {
    const flushRaf = installRafQueue()
    enableEditPaintingForAsset(
      { alias: 'grass-alias', name: 'Grass', type: 'tile' },
      [{ alias: 'grass-alias', tileType: 'common_16' }],
    )
    let layerUpdates = 0
    let prevLayer = useRenderStore.getState().bakedLayers['baked:/Layer']
    const unsubscribe = useRenderStore.subscribe((state) => {
      const nextLayer = state.bakedLayers['baked:/Layer']
      if (nextLayer !== prevLayer) {
        layerUpdates++
        prevLayer = nextLayer
      }
    })
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseDown(host, { button: 0, clientX: 102, clientY: 204 })
    fireEvent.mouseMove(host, { clientX: 103, clientY: 205 })
    fireEvent.mouseMove(host, { clientX: 104, clientY: 206 })
    flushRaf()

    expect(layerUpdates).toBe(1)
    expect(useRenderStore.getState().bakedLayers['baked:/Layer']?.cells).toEqual([
      { x: 10, y: 21, z: 0 },
    ])
    unsubscribe()
  })

  it('keeps all unique tile cells when a fast drag revisits duplicates in one frame', () => {
    const flushRaf = installRafQueue()
    enableEditPaintingForAsset(
      { alias: 'grass-alias', name: 'Grass', type: 'tile' },
      [{ alias: 'grass-alias', tileType: 'common_16' }],
    )
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseDown(host, { button: 0, clientX: 102, clientY: 204 })
    fireEvent.mouseMove(host, { clientX: 112, clientY: 204 })
    fireEvent.mouseMove(host, { clientX: 103, clientY: 205 })
    fireEvent.mouseMove(host, { clientX: 122, clientY: 204 })
    flushRaf()

    expect(useRenderStore.getState().bakedLayers['baked:/Layer']?.cells).toEqual([
      { x: 10, y: 21, z: 0 },
      { x: 11, y: 21, z: 0 },
      { x: 12, y: 21, z: 0 },
    ])
  })

  it('does not persist a tile drag that only revisits existing cells', () => {
    const flushRaf = installRafQueue()
    enableEditPaintingForAsset(
      { alias: 'grass-alias', name: 'Grass', type: 'tile' },
      [{ alias: 'grass-alias', tileType: 'common_16' }],
    )
    useRenderStore.getState().paintBakedCells('baked:/Layer', [
      { x: 10, y: 21, z: 0, token: 'Grass' },
    ])
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseDown(host, { button: 0, clientX: 102, clientY: 204 })
    fireEvent.mouseMove(host, { clientX: 103, clientY: 205 })
    flushRaf()
    fireEvent.mouseUp(host)

    expect(bakedApi.setCells).not.toHaveBeenCalled()
  })

  it('keeps object hover on the front/bottom edit face', () => {
    enableEditPaintingForAsset(
      { alias: 'tree-alias', name: 'Tree', type: 'asset' },
      [{
        alias: 'tree-alias',
        anchorX: 0.5,
        anchorY: 0,
        widthPx: 48,
        heightPx: 64,
        ppu: 16,
        objectHeightPx: 16,
      }],
    )
    const { getByTestId } = render(<RenderCanvas />)

    fireEvent.mouseMove(getByTestId('render-canvas'), { clientX: 102, clientY: 204 })

    expect(useRenderStore.getState().editHoverCell).toEqual({ x: 10, y: 20, z: 0 })
  })

  it('uses top-face-aligned tile cells for box fill ranges', async () => {
    enableEditPaintingForAsset(
      { alias: 'grass-alias', name: 'Grass', type: 'tile' },
      [{ alias: 'grass-alias', tileType: 'common_16' }],
      'box',
    )
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseDown(host, { button: 0, clientX: 12, clientY: 22 })
    fireEvent.mouseMove(host, { clientX: 34, clientY: 45 })

    expect(useRenderStore.getState().editHoverCell).toEqual({ x: 3, y: 5, z: 0 })
    expect(useRenderStore.getState().editBox).toEqual({ x0: 1, y0: 3, x1: 3, y1: 5, z: 0 })

    fireEvent.mouseUp(host)

    await vi.waitFor(() => expect(bakedApi.setCells).toHaveBeenCalled())
    expect(vi.mocked(bakedApi.setCells).mock.calls.at(-1)?.[1]).toEqual([
      { x: 1, y: 3, z: 0, token: 'Grass' },
      { x: 1, y: 4, z: 0, token: 'Grass' },
      { x: 1, y: 5, z: 0, token: 'Grass' },
      { x: 2, y: 3, z: 0, token: 'Grass' },
      { x: 2, y: 4, z: 0, token: 'Grass' },
      { x: 2, y: 5, z: 0, token: 'Grass' },
      { x: 3, y: 3, z: 0, token: 'Grass' },
      { x: 3, y: 4, z: 0, token: 'Grass' },
      { x: 3, y: 5, z: 0, token: 'Grass' },
    ])
  })

  it('writes box-fill tile cells locally before async persist resolves', () => {
    vi.mocked(bakedApi.setCells).mockImplementationOnce(() => new Promise<void>(() => {}))
    enableEditPaintingForAsset(
      { alias: 'grass-alias', name: 'Grass', type: 'tile' },
      [{ alias: 'grass-alias', tileType: 'common_16' }],
      'box',
    )
    useRenderStore.getState().bindBakedLayerAsset('baked:/Layer', 'Grass', 'tile', 'grass-alias')
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseDown(host, { button: 0, clientX: 12, clientY: 22 })
    fireEvent.mouseMove(host, { clientX: 24, clientY: 35 })
    fireEvent.mouseUp(host)

    expect(useRenderStore.getState().bakedLayers['baked:/Layer']?.cells).toEqual([
      { x: 1, y: 3, z: 0 },
      { x: 1, y: 4, z: 0 },
      { x: 2, y: 3, z: 0 },
      { x: 2, y: 4, z: 0 },
    ])
    expect(bakedApi.setCells).toHaveBeenCalledTimes(1)
  })

  it('erases a single tile cell from the active baked layer', () => {
    enableEditPainting('free')
    const store = useRenderStore.getState()
    store.setEditTool('erase')
    store.paintBakedCells('baked:/Layer', [
      { x: 1, y: 2, z: 0, token: 'grass' },
      { x: 3, y: 4, z: 0, token: 'grass' },
    ])
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseDown(host, { button: 0, clientX: 12, clientY: 22 })
    fireEvent.mouseUp(host)

    expect(vi.mocked(bakedApi.setCells).mock.calls.at(-1)?.[1]).toEqual([
      { x: 3, y: 4, z: 0, token: 'grass' },
    ])
  })

  it('erases a whole object instance when clicking a column cell', () => {
    enableEditPainting('free')
    const store = useRenderStore.getState()
    store.setEditTool('erase')
    store.setEditZ(1)
    store.setBakedLayers([
      {
        nodePath: '/Layer',
        nodeName: 'Layer',
        value: 1,
        assetName: 'Tree',
        assetType: 'object',
        cells: [
          { x: 4, y: 7, z: 0, token: 'Tree', state: { instanceId: 'inst_one', role: 'anchor', footprintDx: 0, footprintDy: 0, columnDz: 0, columnHeight: 2, footprintOrigin: { x: 4, y: 7, z: 0 } } },
          { x: 4, y: 7, z: 1, token: 'Tree', state: { instanceId: 'inst_one', role: 'column', footprintDx: 0, footprintDy: 0, columnDz: 1, columnHeight: 2, footprintOrigin: { x: 4, y: 7, z: 0 } } },
          { x: 9, y: 9, z: 0, token: 'Rock' },
        ],
      },
    ])
    store.setActiveBakedLayer('baked:/Layer')
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseDown(host, { button: 0, clientX: 42, clientY: 72 })
    fireEvent.mouseUp(host)

    expect(vi.mocked(bakedApi.setCells).mock.calls.at(-1)?.[1]).toEqual([
      { x: 9, y: 9, z: 0, token: 'Rock' },
    ])
  })

  it('eyedrops the exact asset alias from the active baked layer', () => {
    enableEditPainting('free')
    const store = useRenderStore.getState()
    store.setEditTool('eyedropper')
    store.setBakedLayers([
      {
        nodePath: '/Layer',
        nodeName: 'Layer',
        value: 1,
        assetName: 'Tree',
        assetAlias: 'tree-exact-alias',
        assetType: 'object',
        cells: [{ x: 1, y: 2, z: 0, token: 'Tree' }],
        attributes: { asset_name: 'Tree', asset_alias: 'tree-exact-alias', asset_type: 'object' },
      },
    ])
    store.setActiveBakedLayer('baked:/Layer')
    writePaintAsset(null)
    const { getByTestId } = render(<RenderCanvas />)

    fireEvent.mouseDown(getByTestId('render-canvas'), { button: 0, clientX: 12, clientY: 22 })

    expect(readPaintAsset()).toMatchObject({
      alias: 'tree-exact-alias',
      name: 'Tree',
    })
    expect(bakedApi.setCells).not.toHaveBeenCalled()
  })

  it('routes Ctrl+Z and Ctrl+Y to baked history while Preview edit mode is active', async () => {
    enableEditPainting('free')
    render(<RenderCanvas />)

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true })

    await vi.waitFor(() => expect(bakedApi.undo).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(bakedApi.redo).toHaveBeenCalledTimes(1))
  })

  it('does not intercept undo shortcuts outside Preview edit mode', () => {
    const store = useRenderStore.getState()
    store.setViewMode('topBillboard')
    store.setDrawMode('asset')
    store.setEditMode(false)
    render(<RenderCanvas />)

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })

    expect(bakedApi.undo).not.toHaveBeenCalled()
  })

  it('waits for an in-flight paint persist before running baked undo', async () => {
    let resolvePersist!: () => void
    vi.mocked(bakedApi.setCells).mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolvePersist = resolve
    }))
    enableEditPainting('free')
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseDown(host, { button: 0, clientX: 12, clientY: 22 })
    fireEvent.mouseUp(host)
    expect(bakedApi.setCells).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    await Promise.resolve()

    expect(bakedApi.undo).not.toHaveBeenCalled()

    resolvePersist()
    await vi.waitFor(() => expect(bakedApi.undo).toHaveBeenCalledTimes(1))
  })

  it('DEAD-STOP regression: a rejected/no-op paint write does not wedge repainting the dropped cell (gesture set reconciles to store)', async () => {
    // Faithful repro of the parent-diagnosed dead-stop: enqueuePaintCell optimistically
    // marks a cell in the gesture dedupe set, but the flush's paintBakedCells write is
    // a no-op / rejected for it (store returns unchanged) so layer.cells never gets it.
    // Pre-fix the cell stayed marked "painted" forever → enqueue dropped every future
    // attempt at it WITHIN the stroke → dead region. Post-fix the set reconciles to the
    // store truth on each flush, so revisiting the cell re-paints it.
    const flushRaf = installRafQueue()
    enableEditPaintingForAsset(
      { alias: 'grass-alias', name: 'Grass', type: 'tile' },
      [{ alias: 'grass-alias', tileType: 'common_16' }],
    )
    // Drop the FIRST paint write (simulate the store rejecting/no-op'ing the append).
    const real = useRenderStore.getState().paintBakedCells
    let drops = 1
    const spy = vi.spyOn(useRenderStore.getState(), 'paintBakedCells').mockImplementation((k, u) => {
      if (drops > 0) { drops--; return }
      return real(k, u)
    })

    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    // Single continuous stroke. Cell A=(10,21) on mousedown → write DROPPED.
    fireEvent.mouseDown(host, { button: 0, clientX: 102, clientY: 204 })
    flushRaf()
    expect(useRenderStore.getState().bakedLayers['baked:/Layer']?.cells ?? []).toEqual([])

    spy.mockRestore()

    // Move to B=(11,21) (lands), then move BACK to A within the SAME stroke. A was
    // marked in the live gesture set but never reached the store; it must re-land.
    fireEvent.mouseMove(host, { clientX: 112, clientY: 204 })
    flushRaf()
    fireEvent.mouseMove(host, { clientX: 102, clientY: 204 })
    flushRaf()
    fireEvent.mouseUp(host)

    expect(
      useRenderStore.getState().bakedLayers['baked:/Layer']!.cells.some(
        (c) => c.x === 10 && c.y === 21 && c.z === 0,
      ),
    ).toBe(true)
  })

  it('DEAD-STOP regression: a mid-stroke turnover that keeps prior cells still lets NEW cells land', () => {
    const flushRaf = installRafQueue()
    enableEditPaintingForAsset(
      { alias: 'grass-alias', name: 'Grass', type: 'tile' },
      [{ alias: 'grass-alias', tileType: 'common_16' }],
    )
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseDown(host, { button: 0, clientX: 102, clientY: 204 })
    fireEvent.mouseMove(host, { clientX: 112, clientY: 204 })
    flushRaf()

    // Replace the layer object (turnover) but keep the cells committed so far.
    const current = useRenderStore.getState().bakedLayers['baked:/Layer']!.cells
    useRenderStore.getState().setBakedLayers([
      { nodePath: '/Layer', nodeName: 'Layer', value: 1, assetName: 'Grass', assetType: 'tile', version: 1, cells: current.map((c) => ({ ...c, token: 'Grass' })) },
    ])
    useRenderStore.getState().setActiveBakedLayer('baked:/Layer')

    // Continue painting NEW cells in the same stroke — must keep landing.
    fireEvent.mouseMove(host, { clientX: 122, clientY: 204 })
    fireEvent.mouseMove(host, { clientX: 132, clientY: 204 })
    flushRaf()
    fireEvent.mouseUp(host)

    const cells = useRenderStore.getState().bakedLayers['baked:/Layer']!.cells
    expect(cells.some((c) => c.x === 13 && c.y === 21 && c.z === 0)).toBe(true)
  })

  it('keeps a long continuous stroke painting even after a mid-stroke layer turnover', () => {
    const flushRaf = installRafQueue()
    enableEditPaintingForAsset(
      { alias: 'grass-alias', name: 'Grass', type: 'tile' },
      [{ alias: 'grass-alias', tileType: 'common_16' }],
    )
    const { getByTestId } = render(<RenderCanvas />)
    const host = getByTestId('render-canvas')

    fireEvent.mouseDown(host, { button: 0, clientX: 102, clientY: 204 })
    for (let i = 1; i <= 4; i++) fireEvent.mouseMove(host, { clientX: 102 + i * 10, clientY: 204 })
    flushRaf()

    // Mid-stroke external turnover: the layer object is replaced, keeping the cells
    // committed so far. The gesture set must reconcile, not wedge.
    const current = useRenderStore.getState().bakedLayers['baked:/Layer']!.cells
    useRenderStore.getState().setBakedLayers([
      { nodePath: '/Layer', nodeName: 'Layer', value: 1, assetName: 'Grass', assetType: 'tile', version: 1, cells: current.map((c) => ({ ...c, token: 'Grass' })) },
    ])
    useRenderStore.getState().setActiveBakedLayer('baked:/Layer')

    // Continue the stroke onto fresh cells — they must keep landing.
    for (let i = 5; i <= 8; i++) fireEvent.mouseMove(host, { clientX: 102 + i * 10, clientY: 204 })
    flushRaf()
    fireEvent.mouseUp(host)

    const cells = useRenderStore.getState().bakedLayers['baked:/Layer']!.cells
    expect(cells.some((c) => c.x === 18 && c.y === 21 && c.z === 0)).toBe(true)
    expect(cells.length).toBeGreaterThanOrEqual(8)
  })

  it('treats same-name different-alias assets as target mismatches', () => {
    const aliasA = '[a][1][2][3][盆栽][5][6][7][抠图][16][10][11][v]'
    const aliasB = '[b][1][2][3][盆栽][5][6][7][抠图][32][10][11][v]'
    const onPaintTargetMismatch = vi.fn().mockResolvedValue(null)
    const store = useRenderStore.getState()
    store.setViewMode('topBillboard')
    store.setDrawMode('asset')
    store.setEditMode(true)
    store.setBrushMode('free')
    store.setAliasMetas([{ alias: aliasA }, { alias: aliasB }])
    store.setBakedLayers([
      {
        nodePath: '/Layer',
        nodeName: 'Layer',
        value: 1,
        assetName: '盆栽',
        assetType: 'object',
        cells: [],
        attributes: { asset_name: '盆栽', asset_type: 'object', asset_alias: aliasA },
      } as never,
    ])
    store.setActiveBakedLayer('baked:/Layer')
    writePaintAsset({ alias: aliasB, name: '盆栽', type: 'asset' })
    const { getByTestId } = render(<RenderCanvas onPaintTargetMismatch={onPaintTargetMismatch} />)

    fireEvent.mouseDown(getByTestId('render-canvas'), { button: 0, clientX: 102, clientY: 204 })

    expect(onPaintTargetMismatch).toHaveBeenCalledWith(expect.objectContaining({
      activeLayer: expect.objectContaining({ assetName: '盆栽', assetAlias: aliasA }),
      asset: expect.objectContaining({ name: '盆栽', alias: aliasB }),
    }))
  })
})
