import { describe, expect, it } from 'vitest'
import { fitRect, pointToCell, stampRect, type Grid, type Rect } from './rectFit.ts'

function ones(rows: number, cols: number): Grid {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(1))
}

/** 校验矩形完整落在 region 的非零区域内。 */
function fullyInside(region: Grid, rect: Rect): boolean {
  for (let r = rect.top; r < rect.top + rect.height; r++) {
    for (let c = rect.left; c < rect.left + rect.width; c++) {
      if (region[r]?.[c] === undefined || region[r][c] === 0) return false
    }
  }
  return true
}

function contains(rect: Rect, r: number, c: number): boolean {
  return r >= rect.top && r < rect.top + rect.height && c >= rect.left && c < rect.left + rect.width
}

describe('pointToCell', () => {
  it('maps x→col, y→row with rounding and clamping', () => {
    expect(pointToCell(2.4, 3.6, 10, 10)).toEqual([4, 2]) // [row=round(y), col=round(x)]
    expect(pointToCell(-5, 100, 10, 10)).toEqual([9, 0]) // clamped
  })
})

describe('fitRect', () => {
  it('places the full target rectangle in an open region', () => {
    const region = ones(11, 11)
    const rect = fitRect({ region, px: 5, py: 5, width: 5, height: 3 })!
    expect(rect).not.toBeNull()
    expect(rect.width).toBe(5)
    expect(rect.height).toBe(3)
    expect(fullyInside(region, rect)).toBe(true)
    // center near the point (row 5, col 5)
    const cy = rect.top + (rect.height - 1) / 2
    const cx = rect.left + (rect.width - 1) / 2
    expect(cy).toBeCloseTo(5, 5)
    expect(cx).toBeCloseTo(5, 5)
  })

  it('shrinks to stay fully inside a bounded region', () => {
    // 3-row tall strip; target height 9 must shrink to 3.
    const region: Grid = [
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
    ]
    const rect = fitRect({ region, px: 2, py: 1, width: 3, height: 9 })!
    expect(fullyInside(region, rect)).toBe(true)
    expect(rect.height).toBeLessThanOrEqual(3)
    expect(rect.width).toBe(3)
  })

  it('never pokes outside the valid area (L-shaped region)', () => {
    // Carve a hole so a full 4x4 cannot fit centered on the point.
    const region = ones(8, 8)
    for (let r = 0; r < 8; r++) {
      for (let c = 5; c < 8; c++) region[r][c] = 0
    }
    const rect = fitRect({ region, px: 4, py: 4, width: 6, height: 4 })!
    expect(fullyInside(region, rect)).toBe(true)
  })

  it('anchors to the nearest valid cell when the point lands on 0', () => {
    const region = ones(8, 8)
    // hole around the point cell (row3,col3)
    region[3][3] = 0
    const rect = fitRect({ region, px: 3, py: 3, width: 2, height: 2 })!
    expect(fullyInside(region, rect)).toBe(true)
    expect(rect.height * rect.width).toBeGreaterThanOrEqual(1)
  })

  it('returns null for an all-zero region', () => {
    const region: Grid = Array.from({ length: 5 }, () => new Array<number>(5).fill(0))
    expect(fitRect({ region, px: 2, py: 2, width: 3, height: 3 })).toBeNull()
  })

  it('guarantees at least a 1x1 when a single valid cell exists', () => {
    const region: Grid = Array.from({ length: 5 }, () => new Array<number>(5).fill(0))
    region[4][0] = 1
    const rect = fitRect({ region, px: 0, py: 0, width: 4, height: 4 })!
    expect(rect).not.toBeNull()
    expect(rect.height).toBe(1)
    expect(rect.width).toBe(1)
    expect(contains(rect, 4, 0)).toBe(true)
  })

  it('is deterministic', () => {
    const region = ones(10, 10)
    const a = fitRect({ region, px: 4, py: 6, width: 4, height: 3 })
    const b = fitRect({ region, px: 4, py: 6, width: 4, height: 3 })
    expect(a).toEqual(b)
  })
})

describe('stampRect', () => {
  it('stamps 1s inside the rectangle only', () => {
    const out = stampRect(4, 4, { top: 1, left: 1, height: 2, width: 2 })
    expect(out).toEqual([
      [0, 0, 0, 0],
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
    ])
  })
})
