import { describe, it, expect } from 'vitest'
import { layersDrawnAtCell, topLayerAtCell, type CellQuerySources } from '../cellAttribution'
import { mergeRenderableVoxelLayerKeys, orderBakedKeysForRender } from '../layerKeys'
import type { RendererVoxelLayer, Point3D } from '../../types'

function layer(key: string, cells: Point3D[], visible = true): RendererVoxelLayer {
  const isBaked = key.startsWith('baked:')
  const nodePath = isBaked ? key.slice('baked:'.length) : key.split(':')[1] ?? '/'
  return {
    key,
    nodeId: isBaked ? '__baked__' : key.split(':')[0],
    nodePath,
    nodeName: nodePath,
    value: 1,
    cells,
    visible,
    updatedAt: 0,
    assetName: '',
  }
}

function sources(output: RendererVoxelLayer[], baked: RendererVoxelLayer[]): CellQuerySources {
  const layers = Object.fromEntries(output.map((l) => [l.key, l]))
  const bakedLayers = Object.fromEntries(baked.map((l) => [l.key, l]))
  return {
    layers,
    bakedLayers,
    orderedKeys: mergeRenderableVoxelLayerKeys(
      Object.keys(layers),
      orderBakedKeysForRender(Object.keys(bakedLayers)),
    ),
  }
}

// "Render side provides per-cell drawn content": for any voxel, which layers
// draw on it, ordered visually top-most first (reverse paint order, baked above
// graph output). This is the query the SELECT tool attributes a click to.
describe('layersDrawnAtCell (per-cell draw-content query)', () => {
  it('returns layers drawing on a voxel, top-most first (baked over output)', () => {
    // A generated floor and a hand-baked edit on the SAME voxel. Baked draws
    // after output (mergeRenderableVoxelLayerKeys), so it is visually on top.
    const out = layer('n1:/Floor', [{ x: 0, y: 0, z: 0 }])
    const baked = layer('baked:/Edit', [{ x: 0, y: 0, z: 0 }])
    const hits = layersDrawnAtCell(sources([out], [baked]), 0, 0, 0)
    expect(hits.map((h) => h.layerKey)).toEqual(['baked:/Edit', 'n1:/Floor'])
    expect(hits[0].kind).toBe('baked')
    expect(topLayerAtCell(sources([out], [baked]), 0, 0, 0)?.layerKey).toBe('baked:/Edit')
  })

  it('skips hidden layers (a hidden layer draws nothing, owns no pixel)', () => {
    const out = layer('n1:/Floor', [{ x: 0, y: 0, z: 0 }])
    const baked = layer('baked:/Edit', [{ x: 0, y: 0, z: 0 }], /* visible */ false)
    const hits = layersDrawnAtCell(sources([out], [baked]), 0, 0, 0)
    expect(hits.map((h) => h.layerKey)).toEqual(['n1:/Floor'])
  })

  it('returns empty when no layer draws on the queried voxel', () => {
    const out = layer('n1:/Floor', [{ x: 0, y: 0, z: 0 }])
    expect(layersDrawnAtCell(sources([out], []), 9, 9, 9)).toEqual([])
    expect(topLayerAtCell(sources([out], []), 9, 9, 9)).toBeNull()
  })

  it('paintIndex reflects render order (later = higher = on top)', () => {
    const a = layer('n1:/A', [{ x: 0, y: 0, z: 0 }])
    const b = layer('n2:/B', [{ x: 0, y: 0, z: 0 }])
    const hits = layersDrawnAtCell(sources([a, b], []), 0, 0, 0)
    // Top-most first: B (paintIndex 1) before A (paintIndex 0).
    expect(hits[0].layerKey).toBe('n2:/B')
    expect(hits[0].paintIndex).toBeGreaterThan(hits[1].paintIndex)
  })
})
