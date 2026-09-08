import { describe, expect, it } from 'vitest'
import { pointsAlongPolyline } from './index.js'

describe('points_along_polyline battery', () => {
  it('distributes plot points along a polyline with alternating offsets', () => {
    const res = pointsAlongPolyline({
      points: [[0, 0], [100, 0]],
      count: 4,
      offset: 10,
    })
    expect(res.count).toBe(4)
    const points = res.points as Array<{ x: number; y: number }>
    expect(points.length).toBe(4)
    // For a horizontal line from (0,0) to (100,0):
    // tangent is (1, 0), normal is (0, 1)
    // side alternates between +1 and -1, so y alternates between 10 and -10
    expect(points[0].y).toBe(10)
    expect(points[1].y).toBe(-10)
    expect(points[2].y).toBe(10)
    expect(points[3].y).toBe(-10)
  })

  it('handles single plot point at midpoint', () => {
    const res = pointsAlongPolyline({
      points: [[0, 0], [10, 0]],
      count: 1,
      offset: 2,
    })
    expect(res.count).toBe(1)
    const points = res.points as Array<{ x: number; y: number }>
    expect(points[0]).toEqual({ x: 5, y: 2 })
  })

  it('returns empty when points has fewer than 2 coordinates or count <= 0', () => {
    expect(pointsAlongPolyline({ points: [[1, 2]], count: 4 })).toEqual({ points: [], yaw: [], count: 0 })
    expect(pointsAlongPolyline({ points: [[0, 0], [10, 10]], count: 0 })).toEqual({ points: [], yaw: [], count: 0 })
  })

  it('uses half-width plus margin when roadWidth is provided', () => {
    const narrow = pointsAlongPolyline({
      points: [[0, 0], [100, 0]],
      count: 1,
      roadWidth: 2,
      margin: 2,
    }) as { points: Array<{ x: number; y: number }>; yaw: number[] }
    const wide = pointsAlongPolyline({
      points: [[0, 0], [100, 0]],
      count: 1,
      roadWidth: 8,
      margin: 2,
    }) as { points: Array<{ x: number; y: number }> }
    expect(Math.abs(narrow.points[0]!.y)).toBe(3)
    expect(Math.abs(wide.points[0]!.y)).toBe(6)
    expect(narrow.yaw[0]).toBeCloseTo(0, 5)
  })
})
