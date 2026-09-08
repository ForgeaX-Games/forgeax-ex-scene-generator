import { describe, expect, it } from 'vitest'
import { colorForValue, colorForValueCss, hueForValue } from '../palette'

describe('palette colorForValue', () => {
  it('uses golden-angle hue keyed by value', () => {
    expect(hueForValue(1)).toBeCloseTo((1 * 137.508) % 360, 5)
    expect(hueForValue(2)).toBeCloseTo((2 * 137.508) % 360, 5)
  })

  it('is stable for the same value', () => {
    const a = colorForValue(3)
    const b = colorForValue(3)
    expect(a).toEqual(b)
  })

  it('differs across consecutive values', () => {
    const a = colorForValue(1)
    const b = colorForValue(2)
    expect(a.r !== b.r || a.g !== b.g || a.b !== b.b).toBe(true)
  })

  it('exports CSS that matches RGBA components', () => {
    const c = colorForValue(1)
    expect(colorForValueCss(1)).toBe(`rgba(${c.r}, ${c.g}, ${c.b}, ${(c.a / 255).toFixed(3)})`)
  })

  it('selected overrides to accent green', () => {
    expect(colorForValue(1, { selected: true })).toEqual({ r: 212, g: 255, b: 72, a: 255 })
  })
})
