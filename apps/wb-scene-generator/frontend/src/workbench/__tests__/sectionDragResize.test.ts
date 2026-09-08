import { describe, expect, it } from 'vitest'
import { applySectionDragDelta } from '../sectionDragResize.js'

describe('applySectionDragDelta', () => {
  const order = ['a', 'b', 'c'] as const
  const min = () => 48

  it('grows only the target section when dy is positive', () => {
    const h = { a: 100, b: 100, c: 100 }
    expect(applySectionDragDelta(h, order, 'b', 20, min)).toEqual({ a: 100, b: 120, c: 100 })
  })

  it('shrinks the target until min then cascades upward', () => {
    const h = { a: 80, b: 52, c: 100 }
    expect(applySectionDragDelta(h, order, 'b', -30, min)).toEqual({ a: 54, b: 48, c: 100 })
  })

  it('keeps cascading through multiple sections at minimum', () => {
    const h = { a: 48, b: 48, c: 100 }
    expect(applySectionDragDelta(h, order, 'c', -40, min)).toEqual({ a: 48, b: 48, c: 60 })
  })
})
