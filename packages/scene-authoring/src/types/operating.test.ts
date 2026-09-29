import { describe, expect, it } from 'vitest'

import { buildNetwork, buildNetwork3d, buildPoint2d, buildPoint3d, buildPolygon, buildPolyline, buildPolyline3d, buildSpline, diagnoseGeometry } from './operating.js'
import { shapeTreeFromList } from './shape.js'

describe('operating geometry', () => {
  it('builds a finite point2d site and rejects NaN', () => {
    expect(buildPoint2d({ x: 4, y: -2 }).geometry).toEqual({ kind: 'point2d', x: 4, y: -2 })
    expect(buildPoint2d({}).geometry).toEqual({ kind: 'point2d', x: 0, y: 0 })
    expect(buildPoint2d({ x: Number.NaN, y: 1 }).error).toMatch(/finite/)
    expect(diagnoseGeometry({ kind: 'point2d', x: 3, y: 8 })).toBeNull()
  })

  it('accepts a finite polyline and rejects a collapsed one', () => {
    expect(buildPolyline({ points: [[0, 0], [10, 0]] }).error).toBeUndefined()
    expect(buildPolyline({ points: [[1, 1], [1, 1]] }).error).toMatch(/zero length/)
    expect(diagnoseGeometry({ kind: 'polyline', points: [[0, 0]] })?.code).toBe('SCENE_GEOMETRY_DEGENERATE')
  })

  it('accepts Geometry point2d (and host { geometry }) as the same site as [x, y]', () => {
    const built = buildPolyline({
      points: [
        { kind: 'point2d', x: 0, y: 0 },
        { geometry: { kind: 'point2d', x: 10, y: 4 } },
        { x: 10, y: 8 },
      ],
    })
    expect(built.error).toBeUndefined()
    expect(built.geometry).toEqual({
      kind: 'polyline',
      points: [[0, 0], [10, 4], [10, 8]],
    })
  })

  it('accepts a ShapeTree / DataTree list of sites on the points port', () => {
    const built = buildPolyline({
      points: shapeTreeFromList([
        { kind: 'point2d', x: 0, y: 0 },
        [10, 0],
      ]),
    })
    expect(built.error).toBeUndefined()
    expect(built.geometry).toEqual({ kind: 'polyline', points: [[0, 0], [10, 0]] })
  })

  it('rejects a self-crossing polygon and accepts a simple ring', () => {
    expect(buildPolygon({ points: [[0, 0], [4, 0], [4, 3], [0, 3]] }).error).toBeUndefined()
    expect(buildPolygon({ points: [[0, 0], [4, 4], [0, 4], [4, 0]] }).error).toMatch(/cross/)
  })

  it('accepts hole rings as point lists or a polyline geometry', () => {
    const outer = [[0, 0], [10, 0], [10, 8], [0, 8]]
    const hole = [[2, 2], [4, 2], [4, 4], [2, 4]]
    expect(buildPolygon({ points: outer, holes: [hole] }).error).toBeUndefined()
    const ring = buildPolyline({ points: hole }).geometry
    expect(buildPolygon({ points: outer, holes: [ring] }).error).toBeUndefined()
    expect(buildPolygon({
      points: outer,
      holes: shapeTreeFromList([hole]),
    }).error).toBeUndefined()
  })

  it('builds a network from nodes and indexed edges', () => {
    const nodes = [[0, 0], [8, 0], [8, 6]]
    expect(buildNetwork({
      nodes,
      edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
    }).error).toBeUndefined()
    const spline = buildSpline({ points: [[8, 0], [10, 3], [8, 6]], degree: 2 }).geometry
    expect(buildNetwork({
      nodes,
      edges: [{ from: 1, to: 2, curve: spline }],
    }).error).toBeUndefined()
    expect(buildNetwork({ edges: [buildPolyline({ points: [[0, 0], [8, 0]] }).geometry] }).error).toMatch(/nodes/)
    expect(buildNetwork({ nodes, edges: [{ kind: 'polyline', points: [[0, 0], [8, 0]] }] }).error).toMatch(/from, to/)
    expect(buildNetwork({ nodes, edges: [{ from: 0, to: 9 }] }).error).toMatch(/out-of-range/)
    expect(buildNetwork({ nodes: [[0, 0], [0, 0]], edges: [{ from: 0, to: 1 }] }).error).toMatch(/zero length/)
    const drifted = buildSpline({ points: [[0, 0], [4, 4], [9, 6]], degree: 2 }).geometry
    expect(buildNetwork({ nodes, edges: [{ from: 1, to: 2, curve: drifted }] }).error).toMatch(/endpoints/)
  })

  it('accepts a spline with a degree', () => {
    const built = buildSpline({ points: [[0, 0], [2, 4], [6, 1]], degree: 2 })
    expect(built.error).toBeUndefined()
    expect(built.geometry).toEqual(expect.objectContaining({ kind: 'spline', degree: 2 }))
  })

  it('builds point3d and rejects a 2d point list on polyline3d', () => {
    expect(buildPoint3d({ x: 1, y: 2, z: 3 }).geometry).toEqual({ kind: 'point3d', x: 1, y: 2, z: 3 })
    expect(buildPolyline3d({ points: [[0, 0, 0], [4, 0, 2]] }).error).toBeUndefined()
    expect(buildPolyline3d({ points: [[0, 0], [4, 0]] }).error).toMatch(/point3d/)
    expect(diagnoseGeometry({ kind: 'polyline3d', points: [[0, 0, 1], [0, 0, 1]] })?.code).toBe('SCENE_GEOMETRY_DEGENERATE')
  })

  it('keeps network3d node indices and requires 3d endpoints', () => {
    const nodes = [[0, 0, 0], [8, 0, 1], [8, 6, 2]]
    expect(buildNetwork3d({
      nodes,
      edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
    }).error).toBeUndefined()
    expect(buildNetwork3d({ nodes: [[0, 0], [8, 0]], edges: [{ from: 0, to: 1 }] }).error).toMatch(/point3d/)
  })
})
