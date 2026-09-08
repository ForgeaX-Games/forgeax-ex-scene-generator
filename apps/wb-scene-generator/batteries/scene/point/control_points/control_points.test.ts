import { describe, expect, it } from 'vitest'
import { controlPoints, parsePointsList } from './index.js'

describe('control_points battery', () => {
  it('parses literal coordinate tuples', () => {
    const res = controlPoints({
      points: [[6, 24], [18, 20], [30, 26], [42, 22]],
    })
    expect(res.count).toBe(4)
    expect(res.points).toEqual([
      { x: 6, y: 24 },
      { x: 18, y: 20 },
      { x: 30, y: 26 },
      { x: 42, y: 22 },
    ])
  })

  it('parses point objects with {x, y}', () => {
    const res = controlPoints({
      points: [{ x: 5, y: 10 }, { x: 15, y: 25 }],
    })
    expect(res.count).toBe(2)
    expect(res.points).toEqual([
      { x: 5, y: 10 },
      { x: 15, y: 25 },
    ])
  })

  it('handles empty or malformed inputs gracefully', () => {
    expect(controlPoints({ points: [] })).toEqual({ points: [], count: 0 })
    expect(controlPoints({ points: null })).toEqual({ points: [], count: 0 })
  })
})
