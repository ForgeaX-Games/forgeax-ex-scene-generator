import { describe, expect, it } from 'vitest'
import { buildSplatField, rankSplatMaterialNames } from './buildSplatField'
import { buildSurfaceField, type TileCellSample } from './surfaceOwner'

function s(x: number, y: number, z: number, layerIdx: number, assetName: string): TileCellSample {
  return {
    x, y, z, layerIdx, assetName,
    value: layerIdx + 1,
    layerKey: `L${layerIdx}`,
    nodeId: `n${layerIdx}`,
  }
}

describe('rankSplatMaterialNames', () => {
  it('ranks by coverage and caps at 4', () => {
    const field = buildSurfaceField([
      s(0, 0, 0, 0, 'Water'),
      s(1, 0, 0, 0, 'Water'),
      s(2, 0, 0, 0, 'Water'),
      s(0, 1, 1, 1, 'Ground2'),
      s(1, 1, 1, 1, 'Ground2'),
      s(0, 2, 0, 2, 'Rock'),
    ])
    expect(rankSplatMaterialNames(field)).toEqual(['Water', 'Ground2', 'Rock'])
  })
})

describe('buildSplatField', () => {
  it('assigns RGBA channels per material slot', () => {
    const field = buildSurfaceField([
      s(0, 0, 0, 0, 'Water'),
      s(1, 0, 2, 1, 'Ground2'),
    ])
    const splat = buildSplatField(field, ['Water', 'Ground2'], { blurPasses: 0 })
    expect(splat).not.toBeNull()
    expect(splat!.slots).toEqual(['Water', 'Ground2'])
    // cell (0,0) → R, cell (1,0) → G
    const w0 = splat!.weights
    expect(w0[0]).toBe(255) // R at (0,0)
    expect(w0[1]).toBe(0)
    const o1 = 1 * 4
    expect(w0[o1]).toBe(0)
    expect(w0[o1 + 1]).toBe(255) // G at (1,0)
  })

  it('blur softens boundaries', () => {
    const field = buildSurfaceField([
      s(0, 0, 0, 0, 'Water'),
      s(1, 0, 0, 0, 'Ground2'),
    ])
    const hard = buildSplatField(field, ['Water', 'Ground2'], { blurPasses: 0 })!
    const soft = buildSplatField(field, ['Water', 'Ground2'], { blurPasses: 1 })!
    // After blur, Water cell should pick up some G weight from neighbor.
    expect(soft.weights[1]).toBeGreaterThan(hard.weights[1])
  })
})
