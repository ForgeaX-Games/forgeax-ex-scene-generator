import { describe, expect, it } from 'vitest'
import {
  buildObjectPlacements,
  buildSurfaceField,
  packFamilyStem,
  pickModelVariant,
  worldXY,
} from './placements.js'
import { MESH3D_CELL_SIZE } from './types.js'

describe('mesh3d-export placements', () => {
  it('shares derived-stem resolution with frontend modelVariants', () => {
    expect(packFamilyStem('realistic_hd_northern_red_oak_1')).toBe('northern_red_oak')
    expect(
      pickModelVariant('northern_red_oak', 'k', ['realistic_hd_northern_red_oak_1', 'firtree1']),
    ).toBe('realistic_hd_northern_red_oak_1')
    expect(
      pickModelVariant('high_poly_tree', 'k', ['realistic_high_poly_tree_1']),
    ).toBe('realistic_high_poly_tree_1')
  })

  it('picks numbered family variants stably', () => {
    const catalog = ['firtree1', 'firtree2', 'firtree3']
    const a = pickModelVariant('firtree', 'layer|id1|firtree', catalog)
    const b = pickModelVariant('firtree', 'layer|id1|firtree', catalog)
    expect(a).toBe(b)
    expect(catalog).toContain(a)
  })

  it('anchors objects to terrain top', () => {
    const terrain = buildSurfaceField([
      { x: 2, y: 3, z: 4, layerIdx: 0, assetName: 'Grass', layerKey: '/g' },
    ])
    const placements = buildObjectPlacements(
      [{ x: 2, y: 3, z: 1, assetName: 'rock1', instanceId: 'r1', layerKey: '/o' }],
      terrain,
      ['rock1'],
    )
    expect(placements).toHaveLength(1)
    expect(placements[0]!.groundZ).toBe((4 + 1) * MESH3D_CELL_SIZE)
    const { wx, wy } = worldXY(2, 3, 2, 2, 3, 3)
    expect(wx).toBe(0)
    expect(wy).toBe(0)
  })
})
