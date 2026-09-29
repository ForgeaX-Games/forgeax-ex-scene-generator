import { describe, expect, it } from 'vitest'

import { point2d } from '../../batteries/Modeling/geometry2d/point2d/index.js'

describe('Point2d Modeling battery', () => {
  it('builds Geometry point2d from authoring-metre x and y', () => {
    const out = point2d({ x: 12, y: -4 })
    expect(out.error).toBeUndefined()
    expect(out.geometry).toEqual({ kind: 'point2d', x: 12, y: -4 })
  })

  it('defaults both coordinates to the world origin', () => {
    expect(point2d({}).geometry).toEqual({ kind: 'point2d', x: 0, y: 0 })
  })

  it('rejects non-finite coordinates', () => {
    const out = point2d({ x: Number.POSITIVE_INFINITY, y: 1 })
    expect(out.error).toMatch(/finite/)
    expect(out.geometry).toEqual({ kind: 'point2d', x: 0, y: 0 })
  })
})
