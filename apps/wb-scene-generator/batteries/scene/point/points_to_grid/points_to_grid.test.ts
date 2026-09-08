import { describe, expect, it } from 'vitest'
import { pointsToGrid } from './index.ts'
import { normalizePoints } from './normalize.ts'

type Grid = number[][]

function ones(rows: number, cols: number): Grid {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(1))
}

describe('normalizePoints', () => {
  it('accepts objects, arrays, strings and a single point', () => {
    expect(normalizePoints([{ x: 1, y: 2 }, [3, 4], '(5,6)'])).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ])
    expect(normalizePoints({ x: 7, y: 8 })).toEqual([{ x: 7, y: 8 }])
    expect(normalizePoints(null)).toEqual([])
  })
})

describe('pointsToGrid', () => {
  it('marks hit cells with x→col, y→row', () => {
    const region = ones(3, 4)
    const { mask } = pointsToGrid({ region, points: [{ x: 0, y: 0 }, { x: 3, y: 2 }] }) as {
      mask: Grid
    }
    expect(mask).toEqual([
      [1, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 1],
    ])
  })

  it('ignores points outside the valid region', () => {
    const region: Grid = [
      [1, 0, 1],
      [0, 0, 0],
      [1, 1, 1],
    ]
    const { mask } = pointsToGrid({
      region,
      points: [{ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }],
    }) as { mask: Grid }
    // (x1,y0)->(r0,c1) region 0 → ignored; (x0,y0)->(r0,c0) region 1 → 1; (x1,y1)->(r1,c1) region 0 → ignored
    expect(mask).toEqual([
      [1, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ])
  })

  it('ignores out-of-bounds points and rounds coordinates', () => {
    const region = ones(2, 2)
    const { mask } = pointsToGrid({
      region,
      points: [{ x: 5, y: 5 }, { x: -1, y: 0 }, { x: 0.4, y: 0.6 }],
    }) as { mask: Grid }
    // only (0.4,0.6)->round->(r1,c0)
    expect(mask).toEqual([
      [0, 0],
      [1, 0],
    ])
  })

  it('errors on an empty region', () => {
    const res = pointsToGrid({ region: [], points: [{ x: 0, y: 0 }] })
    expect(res.error).toBeTruthy()
  })
})
