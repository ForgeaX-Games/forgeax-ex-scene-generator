import { describe, expect, it } from 'vitest'

import { computeForceLayout, type ForceEdge } from './forceLayout.js'

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

describe('computeForceLayout', () => {
  it('handles trivial graphs', () => {
    expect(computeForceLayout([], [])).toEqual({})
    expect(computeForceLayout(['solo'], [])).toEqual({ solo: { x: 0, y: 0 } })
  })

  it('is deterministic for the same structure', () => {
    const ids = ['a', 'b', 'c', 'd']
    const edges: ForceEdge[] = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'd' },
    ]
    const first = computeForceLayout(ids, edges)
    const second = computeForceLayout(ids, edges)
    expect(second).toEqual(first)
  })

  it('produces finite, distinct positions for every node', () => {
    const ids = ['a', 'b', 'c']
    const pos = computeForceLayout(ids, [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
    ])
    for (const id of ids) {
      expect(Number.isFinite(pos[id].x)).toBe(true)
      expect(Number.isFinite(pos[id].y)).toBe(true)
    }
    expect(dist(pos.a, pos.b)).toBeGreaterThan(1)
    expect(dist(pos.a, pos.c)).toBeGreaterThan(1)
    expect(dist(pos.b, pos.c)).toBeGreaterThan(1)
  })

  it('settles a connected pair near the requested rest length', () => {
    const pos = computeForceLayout(['a', 'b'], [{ from: 'a', to: 'b', restLength: 120 }], {
      repulsion: 4000,
    })
    // Spring rest length pulls them toward ~120; allow a generous tolerance.
    expect(dist(pos.a, pos.b)).toBeGreaterThan(60)
    expect(dist(pos.a, pos.b)).toBeLessThan(220)
  })
})
