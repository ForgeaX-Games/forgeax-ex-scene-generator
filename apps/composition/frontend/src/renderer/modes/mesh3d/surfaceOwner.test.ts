import { describe, expect, it } from 'vitest'
import {
  buildSurfaceField,
  compareSurfaceCoverage,
  isTileTerrainLayer,
  pickDominantOwner,
  type TileCellSample,
} from './surfaceOwner'

function sample(partial: Partial<TileCellSample> & Pick<TileCellSample, 'x' | 'y' | 'z' | 'layerIdx'>): TileCellSample {
  return {
    value: partial.value ?? partial.layerIdx + 1,
    assetName: partial.assetName ?? `Mat${partial.layerIdx}`,
    layerKey: partial.layerKey ?? `L${partial.layerIdx}`,
    nodeId: partial.nodeId ?? `n${partial.layerIdx}`,
    ...partial,
  }
}

describe('isTileTerrainLayer', () => {
  it('accepts only assetType tile', () => {
    expect(isTileTerrainLayer('tile')).toBe(true)
    expect(isTileTerrainLayer('object')).toBe(false)
    expect(isTileTerrainLayer('asset')).toBe(false)
    expect(isTileTerrainLayer(undefined)).toBe(false)
  })
})

describe('compareSurfaceCoverage', () => {
  it('higher z wins', () => {
    expect(compareSurfaceCoverage({ z: 2, layerIdx: 0 }, { z: 1, layerIdx: 9 })).toBeGreaterThan(0)
  })

  it('same z → higher layerIdx wins', () => {
    expect(compareSurfaceCoverage({ z: 1, layerIdx: 3 }, { z: 1, layerIdx: 1 })).toBeGreaterThan(0)
  })
})

describe('buildSurfaceField', () => {
  it('picks max z then max layerIdx per XY', () => {
    const field = buildSurfaceField([
      sample({ x: 0, y: 0, z: 0, layerIdx: 0, value: 1 }),
      sample({ x: 0, y: 0, z: 2, layerIdx: 0, value: 2 }),
      sample({ x: 0, y: 0, z: 2, layerIdx: 1, value: 3 }),
      sample({ x: 1, y: 0, z: 0, layerIdx: 0, value: 1 }),
    ])
    expect(field.owners.get('0,0')).toMatchObject({ z: 2, layerIdx: 1, value: 3 })
    expect(field.owners.get('1,0')).toMatchObject({ z: 0, layerIdx: 0, value: 1 })
    expect(field.minX).toBe(0)
    expect(field.maxX).toBe(1)
  })

  it('returns empty bounds when no samples', () => {
    const field = buildSurfaceField([])
    expect(field.owners.size).toBe(0)
    expect(field.maxX).toBeLessThan(field.minX)
  })
})

describe('pickDominantOwner', () => {
  it('picks globally highest z then layerIdx', () => {
    const field = buildSurfaceField([
      sample({ x: 0, y: 0, z: 0, layerIdx: 5, assetName: 'Low' }),
      sample({ x: 1, y: 0, z: 3, layerIdx: 0, assetName: 'HighZ' }),
      sample({ x: 2, y: 0, z: 3, layerIdx: 2, assetName: 'Top' }),
    ])
    expect(pickDominantOwner(field)?.assetName).toBe('Top')
  })
})
