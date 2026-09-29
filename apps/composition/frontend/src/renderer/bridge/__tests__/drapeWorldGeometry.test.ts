import { describe, expect, it } from 'vitest'
import { drapeStrokePoint, drapeWorldCurves, drapeWorldPoints } from '../drapeWorldGeometry'
import type { Heightfield } from '../../../../../vendor/shared/types/scene/heightfieldField.js'

const field: Heightfield = {
  type: 'heightfield',
  geometry: {
    kind: 'plane',
    origin: [0, 0, 0],
    xAxis: [1, 0, 0],
    yAxis: [0, 1, 0],
    width: 10,
    height: 10,
  },
  columns: 2,
  rows: 2,
  height: [
    [0, 10],
    [20, 40],
  ],
  mask: [
    [1, 1],
    [1, 1],
  ],
  attributes: {},
}

describe('drapeWorldGeometry', () => {
  it('samples Heightfield Z at an authoring site', () => {
    const onField = drapeStrokePoint(field, 5, 5)
    expect(onField[0]).toBe(5)
    expect(onField[1]).toBe(5)
    expect(onField[2]).toBeGreaterThan(0)
  })

  it('leaves points outside the packet as plan XY', () => {
    expect(drapeStrokePoint(field, -4, 2)).toEqual([ -4, 2 ])
  })

  it('drapes curve strokes and vertices onto the packet', () => {
    const draped = drapeWorldCurves([{
      id: 'ridge',
      name: 'Ridge',
      kind: 'spline',
      strokes: [{ points: [[5, 5], [7.5, 7.5]] }],
      vertices: [[5, 5]],
    }], field)
    expect(draped[0]?.strokes[0]?.points[0]?.[2]).toBeGreaterThan(0)
    expect(draped[0]?.strokes[0]?.points[1]?.[2]).toBeGreaterThan(0)
    expect(draped[0]?.vertices?.[0]?.[2]).toBeGreaterThan(0)
  })

  it('does not invent Z when no Heightfield is present', () => {
    const curves = [{
      id: 'line',
      name: 'Line',
      kind: 'polyline' as const,
      strokes: [{ points: [[0, 0], [10, 4]] as const }],
    }]
    expect(drapeWorldCurves(curves, null)).toEqual(curves)
    expect(drapeWorldPoints([{ id: 'site', name: 'Site', x: 4, y: 6 }], null))
      .toEqual([{ id: 'site', name: 'Site', x: 4, y: 6 }])
  })

  it('does not re-drape authored 3D frames', () => {
    const draped = drapeWorldCurves([{
      id: 'ridge3',
      name: 'Ridge3',
      kind: 'polyline',
      space: 'world3d',
      strokes: [{ points: [[5, 5, 1.5]] }],
    }], field)
    expect(draped[0]?.strokes[0]?.points[0]).toEqual([5, 5, 1.5])
    expect(drapeWorldPoints([{ id: 'p', name: 'P', x: 5, y: 5, z: 9, space: 'world3d' }], field)[0]?.z).toBe(9)
  })
})
