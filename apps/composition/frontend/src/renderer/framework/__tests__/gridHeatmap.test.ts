import { describe, expect, it } from 'vitest'
import { colorForGridUnit, colorForGridValue, gridFieldRange, signedGridUnit } from '../gridHeatmap'

function dist(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
}

describe('gridFieldRange', () => {
  it('reads finite min/max and ignores holes', () => {
    expect(gridFieldRange([[-2, 0], [1, Number.NaN]])).toEqual({ min: -2, max: 1 })
    expect(gridFieldRange([[Number.POSITIVE_INFINITY]])).toBeNull()
  })
})

describe('signedGridUnit', () => {
  it('centers a crossing field on zero', () => {
    const range = { min: -4, max: 2 }
    expect(signedGridUnit(-4, range)).toBeCloseTo(-1)
    expect(signedGridUnit(0, range)).toBeCloseTo(0)
    expect(signedGridUnit(2, range)).toBeCloseTo(1)
    expect(signedGridUnit(-2, range)).toBeCloseTo(-0.5)
  })

  it('maps a non-negative field onto 0…1', () => {
    expect(signedGridUnit(0, { min: 0, max: 10 })).toBeCloseTo(0)
    expect(signedGridUnit(5, { min: 0, max: 10 })).toBeCloseTo(0.5)
    expect(signedGridUnit(10, { min: 0, max: 10 })).toBeCloseTo(1)
    expect(signedGridUnit(3, { min: 3, max: 3 })).toBe(1)
  })

  it('maps a non-positive field onto -1…0', () => {
    expect(signedGridUnit(-8, { min: -8, max: 0 })).toBeCloseTo(-1)
    expect(signedGridUnit(0, { min: -8, max: 0 })).toBeCloseTo(0)
    expect(signedGridUnit(-4, { min: -8, max: 0 })).toBeCloseTo(-0.5)
    expect(signedGridUnit(-2, { min: -2, max: -2 })).toBe(-1)
  })
})

describe('colorForGridValue', () => {
  it('keeps neighbors closer than far values on the same ramp', () => {
    const range = { min: 0, max: 1 }
    const a = colorForGridValue(0.10, range)
    const b = colorForGridValue(0.20, range)
    const c = colorForGridValue(0.90, range)
    expect(dist(a, b)).toBeLessThan(dist(a, c))
  })

  it('puts negatives on the blue side and positives on the amber side of a pale zero', () => {
    const range = { min: -1, max: 1 }
    const neg = colorForGridValue(-1, range)
    const zero = colorForGridValue(0, range)
    const pos = colorForGridValue(1, range)
    expect(neg.b).toBeGreaterThan(neg.r)
    expect(pos.r).toBeGreaterThan(pos.b)
    expect(zero.a).toBeLessThan(neg.a)
    expect(zero.a).toBeLessThan(pos.a)
    expect(zero.r).toBeGreaterThan(200)
    expect(zero.g).toBeGreaterThan(200)
    expect(zero.b).toBeGreaterThan(200)
  })

  it('leaves non-finite cells empty', () => {
    expect(colorForGridValue(Number.NaN, { min: 0, max: 1 })).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(colorForGridValue(1, null)).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('clamps the unit stops', () => {
    const lo = colorForGridUnit(-2)
    const hi = colorForGridUnit(2)
    expect(lo).toEqual(colorForGridUnit(-1))
    expect(hi).toEqual(colorForGridUnit(1))
  })
})
