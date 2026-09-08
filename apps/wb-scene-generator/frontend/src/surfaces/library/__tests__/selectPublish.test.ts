// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { writeSelectedLayers, readSelectedLayers } from '../selectedLayerBus'
import { bakedLayerToSnapshot, outputLayerToSnapshot } from '../layerSnapshots'
import type { RendererVoxelLayer, Point3D } from '../../../renderer/types'

beforeEach(() => localStorage.clear())

function layer(key: string, cells: Point3D[]): RendererVoxelLayer {
  const isBaked = key.startsWith('baked:')
  const nodePath = isBaked ? key.slice('baked:'.length) : key.split(':')[1] ?? '/'
  return { key, nodeId: isBaked ? '__baked__' : key.split(':')[0], nodePath, nodeName: nodePath, value: 1, cells, visible: true, updatedAt: 0, assetName: 'grass', assetType: 'tile' }
}

// The SELECT tool writes the store's `selectedLayerKey`; RendererSurface's
// publish effect turns the resolved layer into a snapshot and pushes it through
// `selectedLayerBus` (the LEFT-panel channel) with NO left-panel changes. This
// asserts the bus carries the right layerKey for both a baked and an output
// selection — modeling exactly what RendererSurface publishes.
describe('SELECT → selectedLayerBus publish', () => {
  it('emits the resolved BAKED layer key (the SELECT tool can pick a baked layer)', () => {
    const baked = layer('baked:/Floor', [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])
    // Mirrors RendererSurface's selectedKey → bakedLayerToSnapshot → writeSelectedLayers.
    writeSelectedLayers({
      layers: [bakedLayerToSnapshot(baked)],
      editContext: { editMode: true, viewMode: 'topBillboard', drawMode: 'asset', editAvailable: true },
    })
    const state = readSelectedLayers()
    expect(state?.layers).toHaveLength(1)
    expect(state?.layers[0].layerKey).toBe('baked:/Floor')
    expect(state?.layers[0].kind).toBe('baked')
    expect(state?.layers[0].voxelStats.cellCount).toBe(2)
  })

  it('emits the resolved OUTPUT layer key', () => {
    const out = layer('n1:/Wall', [{ x: 0, y: 0, z: 0 }])
    writeSelectedLayers({
      layers: [outputLayerToSnapshot(out)],
      editContext: { editMode: true, viewMode: 'topBillboard', drawMode: 'asset', editAvailable: true },
    })
    expect(readSelectedLayers()?.layers[0].layerKey).toBe('n1:/Wall')
  })

  it('notifies a left-pane subscriber on the storage event for the selected-layers key', () => {
    const seen: (string | undefined)[] = []
    const handler = (e: StorageEvent): void => {
      if (e.key !== null && e.key !== 'wb-scene-generator.preview.selectedLayers') return
      seen.push(readSelectedLayers()?.layers[0]?.layerKey)
    }
    window.addEventListener('storage', handler)
    writeSelectedLayers({
      layers: [bakedLayerToSnapshot(layer('baked:/Floor', [{ x: 0, y: 0, z: 0 }]))],
      editContext: { editMode: true, viewMode: 'topBillboard', drawMode: 'asset', editAvailable: true },
    })
    window.dispatchEvent(new StorageEvent('storage', { key: 'wb-scene-generator.preview.selectedLayers' }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }))
    window.removeEventListener('storage', handler)
    expect(seen).toEqual(['baked:/Floor'])
  })

  it('clearing the selection removes the bus entry (empty space click)', () => {
    writeSelectedLayers({
      layers: [outputLayerToSnapshot(layer('n1:/Wall', [{ x: 0, y: 0, z: 0 }]))],
      editContext: { editMode: true, viewMode: 'topBillboard', drawMode: 'asset', editAvailable: true },
    })
    expect(readSelectedLayers()).not.toBeNull()
    writeSelectedLayers(null)
    expect(readSelectedLayers()).toBeNull()
  })
})
