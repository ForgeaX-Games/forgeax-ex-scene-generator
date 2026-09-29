import { describe, expect, it } from 'vitest'

import { createGrid } from '../../batteries/Grid/init/create_grid/index.ts'

describe('createGrid', () => {
  it('fills a valued number[][] grid without Geometry', () => {
    const result = createGrid({ columns: 4, rows: 3, fill: 2.5 })
    expect(result.error).toBeUndefined()
    expect(result.grid).toHaveLength(3)
    expect(result.grid.every((row) => row.length === 4)).toBe(true)
    expect(result.grid.flat().every((cell) => cell === 2.5)).toBe(true)
  })

  it('clamps empty or non-finite dimensions to the default 16×16', () => {
    const result = createGrid({ columns: 0, rows: -2, fill: 1 })
    expect(result.grid).toHaveLength(16)
    expect(result.grid[0]).toHaveLength(16)
  })
})
