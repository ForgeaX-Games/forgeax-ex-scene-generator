// @vitest-environment node
//
// Reconcile-on-refresh semantics (the "drawing results lost" / "undo not removing
// content" fixes). refreshBakedLayers now defaults to deferIfLocalPending:true so
// an eager host/external refresh can never clobber optimistic in-flight paint;
// callers that have already drained local edits opt out with
// deferIfLocalPending:false to force the server state in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { refreshBakedLayers } from '../useBakedLayers'
import { bakedApi } from '../bakedApi'
import {
  hasLocalBakedLayerEdits,
  markBakedLayerPersisting,
  markBakedLayerPersistSettled,
  useRenderStore,
} from '../../store'
import type { BakedLayerDTO } from '../bakedApi'

function mockList(layers: BakedLayerDTO[]): void {
  vi.spyOn(bakedApi, 'listResult').mockResolvedValue({ layers })
}

const FLOOR = (cells: BakedLayerDTO['cells'], version: number): BakedLayerDTO => ({
  nodePath: '/Floor', nodeName: 'Floor', value: 1, assetName: 'grass', assetType: 'tile', version, cells,
})

beforeEach(() => {
  useRenderStore.getState().reset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('refreshBakedLayers reconcile semantics', () => {
  it('defers (does not fetch) while a local edit is pending, by default', async () => {
    const s = useRenderStore.getState()
    s.setBakedLayers([FLOOR([], 1)])
    s.paintBakedCells('baked:/Floor', [{ x: 0, y: 0, z: 0, token: 'grass' }])
    expect(hasLocalBakedLayerEdits()).toBe(true)

    const fetchSpy = vi.spyOn(bakedApi, 'listResult').mockResolvedValue({ layers: [] })

    await refreshBakedLayers() // default deferIfLocalPending: true

    expect(fetchSpy).not.toHaveBeenCalled()
    // Optimistic cell survives the (deferred) refresh.
    expect(useRenderStore.getState().bakedLayers['baked:/Floor'].cells).toEqual([
      { x: 0, y: 0, z: 0, token: 'grass' },
    ])
  })

  it('does not clobber optimistic cells even when the server returns a newer version, while still dirty', async () => {
    const s = useRenderStore.getState()
    s.setBakedLayers([FLOOR([], 1)])
    s.paintBakedCells('baked:/Floor', [{ x: 0, y: 0, z: 0, token: 'grass' }])

    // Server has advanced but we haven't settled our persist yet → must defer.
    mockList([FLOOR([{ x: 9, y: 9, z: 0, token: 'grass' }], 5)])
    await refreshBakedLayers()

    expect(useRenderStore.getState().bakedLayers['baked:/Floor'].cells).toEqual([
      { x: 0, y: 0, z: 0, token: 'grass' },
    ])
  })

  it('forces the server state in when local edits are drained (post-settle / undo path)', async () => {
    const s = useRenderStore.getState()
    s.setBakedLayers([FLOOR([], 1)])
    markBakedLayerPersisting('baked:/Floor')
    s.paintBakedCells('baked:/Floor', [{ x: 0, y: 0, z: 0, token: 'grass' }])
    // Persist resolved on the server; local edit drained.
    markBakedLayerPersistSettled('baked:/Floor', true)
    expect(hasLocalBakedLayerEdits()).toBe(false)

    // e.g. an undo reverted the layer server-side.
    mockList([FLOOR([], 2)])
    await refreshBakedLayers({ deferIfLocalPending: false, mode: 'full' })

    expect(useRenderStore.getState().bakedLayers['baked:/Floor'].cells).toEqual([])
  })

  it('forced refresh ignores pending edits (explicit opt-out)', async () => {
    const s = useRenderStore.getState()
    s.setBakedLayers([FLOOR([], 1)])
    s.paintBakedCells('baked:/Floor', [{ x: 0, y: 0, z: 0, token: 'grass' }])
    expect(hasLocalBakedLayerEdits()).toBe(true)

    mockList([FLOOR([{ x: 2, y: 0, z: 0, token: 'grass' }], 3)])
    await refreshBakedLayers({ deferIfLocalPending: false, mode: 'full' })

    expect(useRenderStore.getState().bakedLayers['baked:/Floor'].cells).toEqual([
      { x: 2, y: 0, z: 0, token: 'grass' },
    ])
  })
})
