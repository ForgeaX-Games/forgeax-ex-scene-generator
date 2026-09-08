import { describe, expect, it } from 'vitest'
import { heightfieldScale } from './index.js'

describe('heightfieldScale', () => {
  it('scales discrete level grid into continuous elevation values', () => {
    const grid = [
      [0, 1, 2],
      [1, 3, 2],
      [0, 1, 0],
    ]
    const res = heightfieldScale({ grid, scale: 4.0, smooth: false }) as {
      heightGrid: number[][]
      minElevation: number
      maxElevation: number
    }
    expect(res.heightGrid[1]![1]).toBe(12.0)
    expect(res.minElevation).toBe(0)
    expect(res.maxElevation).toBe(12.0)
  })

  it('applies gaussian smoothing across grid cells', () => {
    const grid = [
      [0, 0, 0, 0],
      [0, 5, 5, 0],
      [0, 5, 5, 0],
      [0, 0, 0, 0],
    ]
    const res = heightfieldScale({ grid, scale: 2.0, smooth: true }) as {
      heightGrid: number[][]
      minElevation: number
      maxElevation: number
    }
    expect(res.heightGrid.length).toBe(4)
    expect(res.maxElevation).toBeGreaterThan(0)
  })

  it('handles empty or missing grid gracefully', () => {
    const res = heightfieldScale({}) as { heightGrid: unknown[]; error?: string }
    expect(res.heightGrid).toEqual([])
    expect(res.error).toBeDefined()
  })
})
