import { describe, expect, it } from 'vitest'
import { splineSample } from './index.js'

describe('splineSample', () => {
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

  it('rejects fewer than two points', () => {
    const res = splineSample({ points: [[1, 1]] })
    expect(res.error).toBeDefined()
  })
})
