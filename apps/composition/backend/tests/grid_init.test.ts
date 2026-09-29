import { describe, expect, it } from 'vitest'

import { createGrid } from '../../batteries/Grid/init/create_grid/index.ts'
import { gridDiamondSquare } from '../../batteries/Grid/init/grid_diamond_square/index.ts'
import { gridFill } from '../../batteries/Grid/init/grid_fill/index.ts'
import { gridGradient } from '../../batteries/Grid/init/grid_gradient/index.ts'
import { gridMidpoint } from '../../batteries/Grid/init/grid_midpoint/index.ts'

describe('Grid/init', () => {
  it('gridFill rewrites every cell and keeps shape', () => {
    const src = createGrid({ columns: 3, rows: 2, fill: 1 }).grid
    const filled = gridFill({ grid: src, fill: 4 })
    expect(filled.error).toBeUndefined()
    expect(filled.grid).toEqual([[4, 4, 4], [4, 4, 4]])
    expect(src[0][0]).toBe(1)
  })

  it('gridFill errors without a grid', () => {
    expect(gridFill({ fill: 1 }).error).toBe('gridFill requires a Grid')
  })

  it('gridGradient writes 0–1 ramps in index space', () => {
    const row = gridGradient({ columns: 3, rows: 3, kind: 'row' }).grid
    expect(row[0][0]).toBe(0)
    expect(row[2][1]).toBe(1)
    const col = gridGradient({ columns: 3, rows: 2, kind: 'col' }).grid
    expect(col[0][0]).toBe(0)
    expect(col[0][2]).toBe(1)
    const radial = gridGradient({ columns: 3, rows: 3, kind: 'radial' }).grid
    expect(radial[1][1]).toBe(0)
    expect(radial[0][0]).toBeCloseTo(1)
  })

  it('diamond-square and midpoint emit 2^n+1 tables in 0–1', () => {
    const diamond = gridDiamondSquare({ power: 3, seed: 11, roughness: 0.4 })
    const mid = gridMidpoint({ power: 3, seed: 11, roughness: 0.4 })
    expect(diamond.grid).toHaveLength(9)
    expect(diamond.grid[0]).toHaveLength(9)
    expect(mid.grid).toHaveLength(9)
    const dFlat = diamond.grid.flat()
    const mFlat = mid.grid.flat()
    expect(Math.min(...dFlat)).toBeCloseTo(0)
    expect(Math.max(...dFlat)).toBeCloseTo(1)
    expect(Math.min(...mFlat)).toBeCloseTo(0)
    expect(Math.max(...mFlat)).toBeCloseTo(1)
    expect(diamond.grid).not.toEqual(mid.grid)
    expect(gridDiamondSquare({ power: 3, seed: 11, roughness: 0.4 }).grid).toEqual(diamond.grid)
  })
})
