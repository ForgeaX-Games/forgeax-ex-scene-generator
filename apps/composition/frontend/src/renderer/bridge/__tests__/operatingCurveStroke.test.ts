import { describe, expect, it } from 'vitest'
import { parseOperatingCurvePayload } from '../useNodePreviews'
import { sampleOperatingSpline, SPLINE_SAMPLES_PER_SEGMENT } from '../operatingCurveStroke'

describe('operating spline stroke', () => {
  it('samples a cubic through three sites instead of two chords', () => {
    const control: Array<[number, number]> = [[40, 0], [18, 48], [40, 30]]
    const sampled = sampleOperatingSpline(control, 3)
    expect(sampled.length).toBe((control.length - 1) * SPLINE_SAMPLES_PER_SEGMENT + 1)
    expect(sampled[0]).toEqual(control[0])
    expect(sampled[sampled.length - 1]).toEqual(control[control.length - 1])
    const mid = sampled[Math.floor(sampled.length / 2)]!
    expect(mid[0]).not.toBeCloseTo(29, 0)
    expect(mid[1]).toBeGreaterThan(20)
  })

  it('keeps degree 1 as the control polygon', () => {
    const control: Array<[number, number]> = [[0, 0], [4, 8], [10, 2]]
    expect(sampleOperatingSpline(control, 1)).toEqual(control)
  })

  it('projects a spline payload to a dense stroke plus control vertices', () => {
    const parsed = parseOperatingCurvePayload({
      kind: 'spline',
      points: [[40, 0], [18, 48], [40, 30]],
      degree: 3,
    })
    expect(parsed?.kind).toBe('spline')
    expect(parsed?.vertices).toEqual([[40, 0], [18, 48], [40, 30]])
    expect(parsed?.strokes[0]?.points.length).toBeGreaterThan(3)
  })

  it('projects a 3d polyline at authored Z without draping', () => {
    const parsed = parseOperatingCurvePayload({
      kind: 'polyline3d',
      points: [[0, 0, 4], [10, 0, 6]],
    })
    expect(parsed?.kind).toBe('polyline')
    expect(parsed?.space).toBe('world3d')
    expect(parsed?.strokes[0]?.points[0]).toEqual([0, 0, 4])
  })

  it('samples a network edge that embeds a spline', () => {
    const parsed = parseOperatingCurvePayload({
      kind: 'network',
      nodes: [[40, 0], [40, 30]],
      edges: [{
        from: 0,
        to: 1,
        curve: { kind: 'spline', points: [[40, 0], [18, 48], [40, 30]], degree: 3 },
      }],
    })
    expect(parsed?.strokes[0]?.points.length).toBeGreaterThan(3)
  })
})
