import { describe, expect, it } from 'vitest'

import { asPlane } from '../../vendor/shared/types/scene/spatial.js'
import { basePlane } from '../../batteries/Modeling/geometry2d/base_plane/index.js'

describe('BasePlane Modeling battery', () => {
  it('builds a Geometry plane from top-left origin, width, and height', () => {
    const out = basePlane({ origin: [4, 6], width: 8, height: 5 })
    expect(out.error).toBeUndefined()
    expect(out.geometry).toEqual(expect.objectContaining({
      kind: 'plane',
      width: 8,
      height: 5,
      origin: [4, 6, 0],
    }))
    expect(asPlane(out.geometry)?.width).toBe(8)
    expect(asPlane({ geometry: out.geometry })?.origin).toEqual([4, 6, 0])
  })

  it('accepts a Geometry point2d as origin', () => {
    const out = basePlane({ origin: { kind: 'point2d', x: 3, y: 7 }, width: 4, height: 2 })
    expect(out.error).toBeUndefined()
    expect(out.geometry).toEqual(expect.objectContaining({
      kind: 'plane',
      origin: [3, 7, 0],
      width: 4,
      height: 2,
    }))
  })

  it('defaults origin to the world origin and size to 10×10 m', () => {
    const out = basePlane({})
    expect(out.geometry).toEqual(expect.objectContaining({
      origin: [0, 0, 0],
      width: 10,
      height: 10,
    }))
  })
})
