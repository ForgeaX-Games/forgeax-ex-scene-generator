import { describe, expect, it } from 'vitest'

import { heightfield } from '../../batteries/Modeling/heightfield/heightfield/index.ts'
import { basePlane } from '../../batteries/Modeling/geometry2d/base_plane/index.ts'
import { polyline2d } from '../../batteries/Modeling/geometry2d/polyline2d/index.ts'
import { network2d } from '../../batteries/Modeling/geometry2d/network2d/index.ts'
import { liftToSurface } from '../../batteries/Modeling/surface/lift_to_surface/index.ts'
import { point3d } from '../../batteries/Modeling/geometry3d/point3d/index.ts'
import { polyline3d } from '../../batteries/Modeling/geometry3d/polyline3d/index.ts'
import { sampleHeightfieldSurfaceHit, sampleHeightfieldWorld } from '../../vendor/shared/types/scene/heightfieldField.ts'
import { densifyPolylineXY } from '../../vendor/shared/types/scene/liftToSurface.ts'

function packet() {
  return heightfield({
    geometry: basePlane({ origin: [0, 0], width: 20, height: 10 }).geometry,
    height: [
      [0, 4, 8, 12],
      [2, 6, 10, 14],
    ],
  }).heightfield
}

describe('Geometry3d + liftToSurface', () => {
  it('constructs point3d / polyline3d and rejects 2d point lists', () => {
    expect(point3d({ x: 1, y: 2, z: 3 }).geometry).toEqual({ kind: 'point3d', x: 1, y: 2, z: 3 })
    expect(polyline3d({ points: [[0, 0, 0], [4, 0, 2]] }).error).toBeUndefined()
    expect(polyline3d({ points: [[0, 0], [4, 0]] }).error).toMatch(/point3d/)
  })

  it('lifts a polyline with matching sampleHeight Z and densifies long edges', () => {
    const field = packet()
    const line = polyline2d({ points: [[2, 2], [18, 8]] }).geometry
    const lifted = liftToSurface({ geometry: line, surface: field })
    expect(lifted.error).toBeUndefined()
    expect(lifted.geometry?.kind).toBe('polyline3d')
    const points = lifted.geometry?.points as number[][]
    expect(points.length).toBeGreaterThan(2)
    expect(points[0]?.[0]).toBeCloseTo(2, 5)
    expect(points[0]?.[1]).toBeCloseTo(2, 5)
    expect(points[0]?.[2]).toBeCloseTo(sampleHeightfieldWorld(field, 2, 2) ?? -1, 5)
    expect(densifyPolylineXY([[0, 0], [10, 0]], 4).length).toBeGreaterThan(2)
  })

  it('keeps network node indices after lift', () => {
    const field = packet()
    const net = network2d({
      nodes: [[2, 2], [16, 2], [16, 8]],
      edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
    }).geometry
    const lifted = liftToSurface({ geometry: net, surface: field })
    expect(lifted.error).toBeUndefined()
    expect(lifted.geometry?.kind).toBe('network3d')
    expect((lifted.geometry?.nodes as unknown[]).length).toBe(3)
    expect((lifted.geometry?.edges as Array<{ from: number; to: number }>)[0]).toEqual(expect.objectContaining({ from: 0, to: 1 }))
  })

  it('errors off the Heightfield', () => {
    const field = packet()
    const line = polyline2d({ points: [[-4, 0], [2, 2]] }).geometry
    expect(liftToSurface({ geometry: line, surface: field }).error).toMatch(/SCENE_NOT_ON_SURFACE/)
  })

  it('sampleSurface hit matches lift Z and planar UV', () => {
    const field = packet()
    const hit = sampleHeightfieldSurfaceHit(field, 2, 2)
    expect(hit?.point[2]).toBeCloseTo(sampleHeightfieldWorld(field, 2, 2) ?? -1, 5)
    expect(hit?.uv[0]).toBeCloseTo(2 / 20, 5)
    expect(hit?.uv[1]).toBeCloseTo(2 / 10, 5)
    expect(hit?.normal).toHaveLength(3)
    expect(typeof hit?.face).toBe('number')
  })
})
