import { describe, expect, it } from 'vitest'
import { polylineRoadSpline } from '../../batteries/scene40/Agents/polyline_road_spline/index.ts'
import { strokeToMesh } from '../../batteries/scene/bridge/stroke_to_mesh/index.ts'
import { hillContourGenerate } from '../../batteries/components/elements/hill_contour_generate/index.ts'
import { buildStrokeMesh } from '../../vendor/shared/types/scene/stroke.ts'

function filled(n = 16): number[][] {
  return Array.from({ length: n }, () => Array.from({ length: n }, () => 1))
}

describe('stroke_to_mesh', () => {
  it('builds a light strip from a road mask (not a full hillside)', () => {
    const mask = [
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
    ]
    const mesh = buildStrokeMesh(mask, { heightGrid: mask })
    expect(mesh).not.toBeNull()
    expect(mesh!.role).toBe('road')
    expect(mesh!.color).toEqual([0.84, 0.8, 0.72])
    expect(mesh!.indices.length).toBeGreaterThanOrEqual(6)
    const zs = []
    for (let i = 2; i < mesh!.positions.length; i += 3) zs.push(mesh!.positions[i]!)
    expect(Math.min(...zs)).toBeGreaterThan(0)
  })

  it('polyline_road_spline → stroke_to_mesh hugs a heightfield', () => {
    const ground = filled(16)
    const hill = hillContourGenerate({ inputGrid: ground, contourLevels: 4, seed: 1, hillCount: 1, peakPosition: 5 })
    const road = polylineRoadSpline({
      inputGrid: ground,
      points: [[2, 8], [8, 7], [13, 9]],
      roadWidth: 2,
      clipToFootprint: true,
    }) as { outputGrid: number[][]; error?: string }
    expect(road.error).toBeUndefined()
    const strip = strokeToMesh({ grid: road.outputGrid, heightGrid: hill.outputGrid })
    expect(strip.error).toBeUndefined()
    expect(strip.mesh?.role).toBe('road')
    expect(strip.triangleCount).toBeGreaterThan(0)
  })
})
