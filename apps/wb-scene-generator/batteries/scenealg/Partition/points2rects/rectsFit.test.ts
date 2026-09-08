import { describe, expect, it } from 'vitest'
import { fitRectIn, placeRects, stampRect, type Grid, type Rect } from './rectsFit.ts'

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

/** 两矩形是否相交（共享任意格）。 */
function overlaps(a: Rect, b: Rect): boolean {
  const ax2 = a.left + a.width
  const ay2 = a.top + a.height
  const bx2 = b.left + b.width
  const by2 = b.top + b.height
  return a.left < bx2 && b.left < ax2 && a.top < by2 && b.top < ay2
}

function cellsSet(grid: Grid): number {
  let n = 0
  for (const row of grid) for (const v of row) if (v !== 0) n += 1
  return n
}

describe('fitRectIn', () => {
  it('places the full target rectangle in an open mask', () => {
    const rect = fitRectIn(ones(11, 11), { px: 5, py: 5, width: 5, height: 3 })!
    expect(rect.width).toBe(5)
    expect(rect.height).toBe(3)
    const cy = rect.top + (rect.height - 1) / 2
    const cx = rect.left + (rect.width - 1) / 2
    expect(cy).toBeCloseTo(5, 5)
    expect(cx).toBeCloseTo(5, 5)
  })

  it('returns null for an all-zero mask', () => {
    const zero: Grid = Array.from({ length: 5 }, () => new Array<number>(5).fill(0))
    expect(fitRectIn(zero, { px: 2, py: 2, width: 3, height: 3 })).toBeNull()
  })
})

describe('placeRects', () => {
  it('keeps every rect inside the region and non-overlapping', () => {
    const region = ones(20, 20)
    const reqs = [
      { px: 3, py: 3, width: 5, height: 5 },
      { px: 16, py: 4, width: 6, height: 4 },
      { px: 4, py: 16, width: 4, height: 6 },
      { px: 15, py: 15, width: 5, height: 5 },
    ]
    const res = placeRects(region, reqs)
    expect(res.placedCount).toBe(4)
    expect(res.grids).toHaveLength(4)

    const rects = res.rects.filter((r): r is Rect => r !== null)
    for (const rect of rects) expect(fullyInside(region, rect)).toBe(true)
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlaps(rects[i], rects[j])).toBe(false)
      }
    }
  })

  it('preserves input order in the output list', () => {
    const region = ones(10, 10)
    const reqs = [
      { px: 1, py: 1, width: 2, height: 2 }, // area 4 (small) → placed last
      { px: 8, py: 8, width: 4, height: 4 }, // area 16 (big) → placed first
    ]
    const res = placeRects(region, reqs)
    // output[0] corresponds to reqs[0] regardless of placement priority
    expect(cellsSet(res.grids[0])).toBe(4)
    expect(cellsSet(res.grids[1])).toBe(16)
  })

  it('shrinks a later/smaller rect when the big one took its space', () => {
    // Narrow 4x4 region; two requests both want 4x4 around the same point.
    const region = ones(4, 4)
    const reqs = [
      { px: 2, py: 2, width: 4, height: 4 }, // big: fills the whole region first
      { px: 2, py: 2, width: 4, height: 4 }, // identical area; tie-break by index, also wants everything
    ]
    const res = placeRects(region, reqs)
    // First fills 16 cells; second has nothing left → empty grid.
    expect(cellsSet(res.grids[0])).toBe(16)
    expect(cellsSet(res.grids[1])).toBe(0)
    expect(res.placedCount).toBe(1)
  })

  it('confines rectangles to the valid area of an L-shaped region', () => {
    const region = ones(8, 8)
    for (let r = 0; r < 8; r++) for (let c = 5; c < 8; c++) region[r][c] = 0
    const reqs = [
      { px: 4, py: 4, width: 6, height: 4 },
      { px: 1, py: 1, width: 3, height: 3 },
    ]
    const res = placeRects(region, reqs)
    for (const rect of res.rects) if (rect) expect(fullyInside(region, rect)).toBe(true)
  })

  it('is deterministic', () => {
    const region = ones(15, 15)
    const reqs = [
      { px: 3, py: 3, width: 5, height: 4 },
      { px: 10, py: 10, width: 4, height: 6 },
      { px: 7, py: 2, width: 3, height: 3 },
    ]
    expect(placeRects(region, reqs)).toEqual(placeRects(region, reqs))
  })

  it('returns empty grids for all requests when region is all zero', () => {
    const region: Grid = Array.from({ length: 6 }, () => new Array<number>(6).fill(0))
    const reqs = [
      { px: 1, py: 1, width: 3, height: 3 },
      { px: 4, py: 4, width: 2, height: 2 },
    ]
    const res = placeRects(region, reqs)
    expect(res.placedCount).toBe(0)
    expect(res.grids).toHaveLength(2)
    for (const g of res.grids) expect(cellsSet(g)).toBe(0)
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
