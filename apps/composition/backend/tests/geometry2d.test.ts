import { describe, expect, it } from 'vitest'

import { network2d } from '../../batteries/Modeling/geometry2d/network2d/index.js'
import { polygon2d } from '../../batteries/Modeling/geometry2d/polygon2d/index.js'
import { polyline2d } from '../../batteries/Modeling/geometry2d/polyline2d/index.js'
import { spline2d } from '../../batteries/Modeling/geometry2d/spline2d/index.js'

describe('Geometry2D Modeling constructors', () => {
  it('builds a polyline from [x, y] and Geometry point2d sites', () => {
    const out = polyline2d({
      points: [
        [0, 0],
        { kind: 'point2d', x: 10, y: 0 },
      ],
    })
    expect(out.error).toBeUndefined()
    expect(out.geometry).toEqual({ kind: 'polyline', points: [[0, 0], [10, 0]] })
  })

  it('builds a spline with a degree', () => {
    const out = spline2d({ points: [[0, 0], [4, 6], [10, 0]], degree: 2 })
    expect(out.error).toBeUndefined()
    expect(out.geometry).toEqual(expect.objectContaining({ kind: 'spline', degree: 2 }))
  })

  it('builds a polygon ring', () => {
    const out = polygon2d({ points: [[0, 0], [10, 0], [10, 8], [0, 8]] })
    expect(out.error).toBeUndefined()
    expect(out.geometry).toEqual(expect.objectContaining({ kind: 'polygon' }))
  })

  it('builds a network from nodes and indexed edges', () => {
    const out = network2d({
      nodes: [[0, 0], [10, 0], [10, 8]],
      edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
    })
    expect(out.error).toBeUndefined()
    expect(out.geometry).toEqual(expect.objectContaining({ kind: 'network' }))
  })
})
