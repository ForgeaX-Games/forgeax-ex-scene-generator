import { describe, expect, it } from 'vitest'
import { BASE_CELL_SIZE } from '../../framework/geometry/constants'
import { buildSurfaceField, type TileCellSample } from './surfaceOwner'
import { buildObjectPlacements, isObjectPropLayer, type ObjectCellSample } from './objectPlacements'

describe('isObjectPropLayer', () => {
  it('accepts object / asset', () => {
    expect(isObjectPropLayer('object')).toBe(true)
    expect(isObjectPropLayer('asset')).toBe(true)
    expect(isObjectPropLayer('tile')).toBe(false)
  })
})

describe('buildObjectPlacements', () => {
  it('groups by instanceId and sits on terrain top', () => {
    const terrain = buildSurfaceField([
      {
        x: 2, y: 3, z: 1, layerIdx: 0, value: 1,
        assetName: 'Mount1', layerKey: 't', nodeId: 'n0',
      } satisfies TileCellSample,
    ])
    const samples: ObjectCellSample[] = [
      { x: 2, y: 3, z: 2, assetName: 'firtree1', instanceId: 'inst_a', layerKey: 'o' },
      { x: 2, y: 4, z: 2, assetName: 'firtree1', instanceId: 'inst_a', layerKey: 'o' },
      { x: 5, y: 5, z: 0, assetName: 'firtree2', instanceId: null, layerKey: 'o' },
    ]
    const places = buildObjectPlacements(samples, terrain, ['firtree1', 'firtree2'])
    expect(places).toHaveLength(2)
    const fir1 = places.find((p) => p.requestedName === 'firtree1')!
    expect(fir1.name).toBe('firtree1')
    expect(fir1.groundZ).toBe(ownerTopForZ(1))
    expect(fir1.x).toBe(2)
    const fir2 = places.find((p) => p.requestedName === 'firtree2')!
    expect(fir2.groundZ).toBe(1 * BASE_CELL_SIZE)
  })

  it('expands family stem firtree via catalog', () => {
    const catalog = ['firtree1', 'firtree2', 'firtree3', 'firtree4', 'firtree5', 'firtree6']
    const samples: ObjectCellSample[] = [
      { x: 0, y: 0, z: 0, assetName: 'firtree', instanceId: 'a', layerKey: 'o' },
      { x: 1, y: 0, z: 0, assetName: 'firtree', instanceId: 'b', layerKey: 'o' },
    ]
    const places = buildObjectPlacements(samples, null, catalog)
    expect(places).toHaveLength(2)
    for (const p of places) {
      expect(p.requestedName).toBe('firtree')
      expect(catalog).toContain(p.name)
    }
  })
})

function ownerTopForZ(z: number): number {
  return (z + 1) * BASE_CELL_SIZE
}
