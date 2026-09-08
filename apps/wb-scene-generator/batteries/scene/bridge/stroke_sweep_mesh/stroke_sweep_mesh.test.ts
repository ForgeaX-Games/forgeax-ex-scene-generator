import { describe, expect, it } from 'vitest'
import { strokeSweepMesh } from './index.js'

describe('strokeSweepMesh', () => {
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
    expect(res.mesh?.positions.length).toBeGreaterThan(0)
    const zs = []
    for (let i = 2; i < (res.mesh?.positions.length ?? 0); i += 3) zs.push(res.mesh!.positions[i]!)
    expect(Math.min(...zs)).toBeCloseTo(2, 5)
    expect(Math.max(...zs)).toBeCloseTo(2, 5)
  })

  it('widens when roadWidth increases', () => {
    const points = [[0, 0], [10, 0], [20, 0]]
    const narrow = strokeSweepMesh({ points, roadWidth: 2 })
    const wide = strokeSweepMesh({ points, roadWidth: 6 })
    const span = (mesh: { positions: readonly number[] } | undefined): number => {
      let minX = Infinity, maxX = -Infinity
      if (!mesh) return 0
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const y = mesh.positions[i + 1]!
        if (y < minX) minX = y
        if (y > maxX) maxX = y
      }
      return maxX - minX
    }
    expect(span(wide.mesh)).toBeGreaterThan(span(narrow.mesh) + 2)
  })

  it('rejects a single point', () => {
    expect(strokeSweepMesh({ points: [[1, 1]] }).error).toBeDefined()
  })
})
