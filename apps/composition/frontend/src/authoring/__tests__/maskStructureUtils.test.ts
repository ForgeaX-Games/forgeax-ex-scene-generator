// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  countNonZeroCells,
  extractGridFromWire,
  gridDimensions,
} from '../maskStructureUtils.js'

describe('maskStructureUtils', () => {
  const sample: number[][] = [
    [0, 1, 0],
    [1, 0, 1],
  ]

  it('extractGridFromWire reads a direct grid', () => {
    expect(extractGridFromWire(sample)).toEqual(sample)
  })

  it('extractGridFromWire uses only the first grid in a multi-item DataTree', () => {
    const other: number[][] = [[9]]
    const wire = [{ path: [0], items: [sample, other] }]
    expect(extractGridFromWire(wire)).toEqual(sample)
  })

  it('gridDimensions and countNonZeroCells summarize mask shape', () => {
    expect(gridDimensions(sample)).toEqual({ rows: 2, cols: 3 })
    expect(countNonZeroCells(sample)).toBe(3)
  })
})
