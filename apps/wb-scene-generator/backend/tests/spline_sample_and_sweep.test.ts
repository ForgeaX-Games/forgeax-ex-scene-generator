import { describe, expect, it } from 'vitest'
import { splineSample } from '../../batteries/scene/bridge/spline_sample/index.js'
import { strokeSweepMesh } from '../../batteries/scene/bridge/stroke_sweep_mesh/index.js'
import { pointsAlongPolyline } from '../../batteries/scene/point/points_along_polyline/index.js'
import { gabledHouses } from '../../batteries/scene/bridge/gabled_houses/index.js'
import { buildHeightfieldMesh, sampleHeightfieldSurface } from '../../vendor/shared/types/scene/heightfield.ts'

describe('S13–S15 curve-first road and house yaw', () => {
  it('samples a dense centerline that still passes through control points', () => {
    const res = splineSample({
      points: [[0, 0], [10, 0], [20, 8]],
      samplesPerSegment: 8,
      roadWidth: 3,
    }) as { points: Array<{ x: number; y: number }>; widths: number[]; yaw: number[]; count: number }
    expect(res.count).toBeGreaterThan(8)
    expect(res.points[0]).toEqual({ x: 0, y: 0 })
    const last = res.points[res.points.length - 1]
    expect(last?.x).toBeCloseTo(20, 5)
    expect(last?.y).toBeCloseTo(8, 5)
    expect(res.widths).toHaveLength(res.count)
    expect(res.widths.every((w) => w === 3)).toBe(true)
    expect(res.yaw).toHaveLength(res.count)
  })

  it('flares width at the start for a village entrance', () => {
    const res = splineSample({
      points: [[0, 0], [20, 0]],
      samplesPerSegment: 10,
      roadWidth: 3,
      flareStart: 1.5,
    }) as { widths: number[] }
    expect(res.widths[0]).toBeGreaterThan(4)
    expect(res.widths[res.widths.length - 1]).toBeCloseTo(3, 5)
  })

  it('sweeps a ribbon whose triangle count follows the centerline, not a grid mask', () => {
    const points = Array.from({ length: 9 }, (_, i) => [i * 2, 10 + Math.sin(i) * 0.4])
    const heightGrid = Array.from({ length: 20 }, () => new Array(20).fill(2))
    const res = strokeSweepMesh({
      points,
      heightGrid,
      roadWidth: 3,
    })
    expect(res.triangleCount).toBe(16)
    expect(res.mesh?.role).toBe('road')
    const zs: number[] = []
    for (let i = 2; i < (res.mesh?.positions.length ?? 0); i += 3) zs.push(res.mesh!.positions[i]!)
    expect(Math.min(...zs)).toBeCloseTo(2, 5)
    expect(Math.max(...zs)).toBeCloseTo(2, 5)
  })

  it('widens the strip and pushes plots out when roadWidth increases', () => {
    const points = [[0, 0], [10, 0], [20, 0]]
    const span = (mesh: { positions: readonly number[] } | undefined): number => {
      let minY = Infinity, maxY = -Infinity
      if (!mesh) return 0
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const y = mesh.positions[i + 1]!
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
      return maxY - minY
    }
    expect(span(strokeSweepMesh({ points, roadWidth: 6 }).mesh))
      .toBeGreaterThan(span(strokeSweepMesh({ points, roadWidth: 2 }).mesh) + 2)

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

  it('rotates the house ridge to follow world yaw through the mesh Y-flip', () => {
    const yaw = Math.PI / 4
    const res = gabledHouses({
      points: [[10, 10]],
      z: [2],
      yaw: [yaw],
      footprint: 4,
      depth: 2,
    })
    const pos = res.mesh!.positions
    let maxZ = -Infinity
    const ridge: Array<[number, number]> = []
    for (let i = 0; i < pos.length; i += 3) {
      const z = pos[i + 2]!
      if (z > maxZ + 1e-6) {
        maxZ = z
        ridge.length = 0
      }
      if (Math.abs(z - maxZ) < 1e-6) ridge.push([pos[i]!, pos[i + 1]!])
    }
    const uniq: Array<[number, number]> = []
    for (const p of ridge) {
      if (!uniq.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-5)) uniq.push(p)
    }
    expect(uniq.length).toBeGreaterThanOrEqual(2)
    const dx = uniq[1]![0] - uniq[0]![0]
    const worldDy = -(uniq[1]![1] - uniq[0]![1])
    const heading = Math.atan2(worldDy, dx)
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
    expect(Math.min(Math.abs(wrap(heading - yaw)), Math.abs(wrap(heading - yaw - Math.PI)))).toBeLessThan(0.05)
  })

  it('adsorbs each road edge and house corner to the heightfield surface', () => {
    const grid = [
      [1, 1, 1, 1],
      [4, 4, 4, 4],
      [8, 8, 8, 8],
      [12, 12, 12, 12],
    ]
    const cellSize = 1
    const terrain = buildHeightfieldMesh(grid, { cellSize })!
    expect(sampleHeightfieldSurface(grid, 1, 2) * cellSize).toBeCloseTo((() => {
      for (let i = 0; i < terrain.positions.length; i += 3) {
        if (Math.abs(terrain.positions[i]! - 1) < 1e-9 && Math.abs(terrain.positions[i + 1]! + 2) < 1e-9) {
          return terrain.positions[i + 2]!
        }
      }
      throw new Error('missing terrain vertex')
    })(), 8)

    const road = strokeSweepMesh({
      points: [[0.5, 1.5], [2.5, 1.5]],
      heightGrid: grid,
      cellSize,
      roadWidth: 2,
    })
    const leftZ = road.mesh!.positions[2]!
    const rightZ = road.mesh!.positions[5]!
    expect(Math.abs(leftZ - rightZ)).toBeGreaterThan(1)
    expect(leftZ).toBeCloseTo(sampleHeightfieldSurface(grid, 0.5, 2.5) * cellSize, 5)
    expect(rightZ).toBeCloseTo(sampleHeightfieldSurface(grid, 0.5, 0.5) * cellSize, 5)

    const x = 1.5
    const y = 1.5
    const houses = gabledHouses({
      points: [[x, y]],
      heightGrid: grid,
      cellSize,
      footprint: 2,
      depth: 2,
      buildingHeight: 2,
      roofHeight: 1,
    })
    const floorZAt = (wx: number, wy: number): number => {
      const mx = wx * cellSize
      const my = -wy * cellSize
      let best = Infinity
      const pos = houses.mesh!.positions
      for (let i = 0; i < pos.length; i += 3) {
        if (Math.hypot(pos[i]! - mx, pos[i + 1]! - my) < 1e-5) {
          const z = pos[i + 2]!
          if (z < best) best = z
        }
      }
      if (!Number.isFinite(best)) throw new Error(`missing house vertex at ${wx},${wy}`)
      return best
    }
    for (const [sx, sy] of [[x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]] as const) {
      expect(floorZAt(sx, sy)).toBeCloseTo(sampleHeightfieldSurface(grid, sx, sy) * cellSize, 5)
    }
  })
})
