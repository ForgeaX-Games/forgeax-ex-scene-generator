import { describe, it, expect } from 'vitest'
import { pageItems } from '../pagination'

const numbersOf = (items: (number | '…')[]) => items.filter((x): x is number => x !== '…')

describe('pageItems', () => {
  it('lists every page exactly once for small totals (the duplicate-"1" regression)', () => {
    // Before the fix the pager emitted a leading edge "1" AND a window starting
    // at 1, rendering "1 1 2 3 4". Each page must now appear once.
    for (const total of [1, 2, 3, 4, 5, 6, 7]) {
      const nums = numbersOf(pageItems(1, total))
      expect(nums).toEqual(Array.from({ length: total }, (_, i) => i + 1))
      expect(new Set(nums).size).toBe(nums.length)
    }
  })

  it('never duplicates a page number across pages/totals', () => {
    for (let total = 1; total <= 25; total++) {
      for (let page = 1; page <= total; page++) {
        const nums = numbersOf(pageItems(page, total))
        expect(new Set(nums).size).toBe(nums.length)
        // Edges always present and unique.
        expect(nums[0]).toBe(1)
        expect(nums[nums.length - 1]).toBe(total)
      }
    }
  })

  it('uses ellipsis + a clamped window for large totals', () => {
    expect(pageItems(1, 12)).toEqual([1, 2, 3, 4, '…', 12])
    expect(pageItems(6, 12)).toEqual([1, '…', 5, 6, 7, '…', 12])
    expect(pageItems(12, 12)).toEqual([1, '…', 9, 10, 11, 12])
  })
})
