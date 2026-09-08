import { describe, expect, it } from 'vitest'
import { valleyHeightfield } from './index.js'

describe('valleyHeightfield', () => {
  it('generates heightGrid and valleyMask with valid dimensions and elevation range', () => {
    const res = valleyHeightfield({
      width: 48,
      height: 48,
      valleyDepth: 14.0,
      valleyWidth: 16.0,
      seed: 23,
    }) as {
      heightGrid: number[][]
      valleyMask: number[][]
      minElevation: number
      maxElevation: number
    }
    expect(res.heightGrid.length).toBe(48)
    expect(res.heightGrid[0]?.length).toBe(48)
    expect(res.valleyMask.length).toBe(48)
    expect(res.minElevation).toBeGreaterThan(0)
    expect(res.maxElevation).toBeGreaterThan(res.minElevation)
  })

  it('is deterministic for the same seed', () => {
    const r1 = valleyHeightfield({ seed: 42, valleyDepth: 12.0 }) as { minElevation: number; maxElevation: number }
    const r2 = valleyHeightfield({ seed: 42, valleyDepth: 12.0 }) as { minElevation: number; maxElevation: number }
    expect(r1.minElevation).toBe(r2.minElevation)
    expect(r1.maxElevation).toBe(r2.maxElevation)
  })
})
