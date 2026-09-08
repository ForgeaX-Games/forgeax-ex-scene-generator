import { describe, expect, it } from 'vitest'
import { gabledHouses } from './index.js'
import { sampleHeightfieldSurface } from '../../../../vendor/shared/types/scene/heightfield.ts'

describe('gabledHouses', () => {
  it('generates gabled house mesh with roof and wall geometry', () => {
    const points = [
      [10, 10],
      [20, 20],
    ]
    const res = gabledHouses({
      points,
      z: [5, 6],
      buildingHeight: 3.5,
      roofHeight: 1.8,
      footprint: 3,
      depth: 2.5,
    })
    expect(res.count).toBe(2)
    expect(res.mesh).toBeDefined()
    expect(res.mesh?.role).toBe('houses')
    expect(res.mesh?.positions.length).toBeGreaterThan(0)
    expect(res.mesh?.indices.length).toBeGreaterThan(0)
    expect(res.mesh?.normals.length).toBe(res.mesh?.positions.length)
  })

  it('rotates the ridge when yaw is provided', () => {
    const aligned = gabledHouses({
      points: [[10, 10]],
      z: [2],
      yaw: [0],
      footprint: 4,
      depth: 2,
    })
    const turned = gabledHouses({
      points: [[10, 10]],
      z: [2],
      yaw: [Math.PI / 2],
      footprint: 4,
      depth: 2,
    })
    const spanX = (mesh: { positions: readonly number[] } | undefined): number => {
      let min = Infinity, max = -Infinity
      if (!mesh) return 0
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const x = mesh.positions[i]!
        if (x < min) min = x
        if (x > max) max = x
      }
      return max - min
    }
    expect(spanX(aligned.mesh)).toBeGreaterThan(spanX(turned.mesh))
  })

  it('maps world yaw through the mesh Y-flip so the ridge follows the road', () => {
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
    const aligned = Math.min(
      Math.abs(wrap(heading - yaw)),
      Math.abs(wrap(heading - yaw - Math.PI)),
    )
    expect(aligned).toBeLessThan(0.05)
  })

  it('drapes each base corner onto the heightfield surface', () => {
    const grid = [
      [1, 1, 1, 1],
      [4, 4, 4, 4],
      [8, 8, 8, 8],
      [12, 12, 12, 12],
    ]
    const x = 1.5
    const y = 1.5
    const res = gabledHouses({
      points: [[x, y]],
      heightGrid: grid,
      footprint: 2,
      depth: 2,
      buildingHeight: 2,
      roofHeight: 1,
    })
    const floorZAt = (wx: number, wy: number): number => {
      let best = Infinity
      const pos = res.mesh!.positions
      for (let i = 0; i < pos.length; i += 3) {
        if (Math.hypot(pos[i]! - wx, pos[i + 1]! + wy) < 1e-5) {
          const z = pos[i + 2]!
          if (z < best) best = z
        }
      }
      if (!Number.isFinite(best)) throw new Error(`missing house vertex at ${wx},${wy}`)
      return best
    }
    for (const [sx, sy] of [[x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]] as const) {
      expect(floorZAt(sx, sy)).toBeCloseTo(sampleHeightfieldSurface(grid, sx, sy), 5)
    }
  })

  it('handles invalid input gracefully', () => {
    const res = gabledHouses({})
    expect(res.error).toBeDefined()
  })
})
