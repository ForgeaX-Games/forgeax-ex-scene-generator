import { describe, expect, it } from 'vitest'
import { point2rect } from './index.ts'

function ones(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(1))
}

function zeros(rows: number, cols: number): number[][] {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
}

describe('point2rect', () => {
  it('stamps a rect near the point in an open region', () => {
    const result = point2rect({ region: ones(10, 10), point: { x: 5, y: 5 }, width: 3, height: 3 })
    expect(result.error).toBeUndefined()
    const grid = result.outputGrid as number[][]
    const ones_ = grid.flat().filter((v) => v === 1)
    expect(ones_.length).toBe(9)
  })

  it('errors (does not silently return an all-zero grid) when the region has zero available cells', () => {
    // 2026-07-01 postmortem regression test: an all-zero region (e.g. dangling
    // Scene/Rest input, or the target area already fully occupied) must surface
    // a loud error so PlaceOneDecoration / PickOneBuilding don't silently produce
    // an invisible, zero-voxel node ("空产").
    const result = point2rect({ region: zeros(5, 5), point: { x: 2, y: 2 }, width: 2, height: 2 })
    expect(result.outputGrid).toBeUndefined()
    expect(typeof result.error).toBe('string')
    expect(result.error as string).toMatch(/no available/i)
    expect(result.error as string).toMatch(/5x5/)
  })

  it('errors when region is missing/empty', () => {
    expect(point2rect({ point: { x: 0, y: 0 } }).error).toMatch(/region is required/)
    expect(point2rect({ region: [], point: { x: 0, y: 0 } }).error).toMatch(/region is required/)
  })

  it('errors when point is missing/invalid', () => {
    const result = point2rect({ region: ones(3, 3), point: { x: 'nope', y: 1 } })
    expect(result.error).toMatch(/point is required/)
  })

  it('still succeeds with a shrunk rect when only a sliver of the region is available', () => {
    const region = zeros(5, 5)
    region[4][0] = 1
    const result = point2rect({ region, point: { x: 0, y: 0 }, width: 4, height: 4 })
    expect(result.error).toBeUndefined()
    const grid = result.outputGrid as number[][]
    expect(grid[4][0]).toBe(1)
    expect(grid.flat().filter((v) => v === 1).length).toBe(1)
  })
})
