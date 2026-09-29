import { describe, expect, it } from 'vitest'
import {
  applyOutputLayerOrder, parentsBeforeChildren, reorderSibling, stackOrderHints,
} from '../outputOrder'

// keys are `${nodeId}:${nodePath}`; siblings are grouped by the SCENE path's
// parent, so rival sinks projecting the same path land in one group.
const nodePathOf = (key: string): string => key.slice(key.indexOf(':') + 1)

describe('applyOutputLayerOrder', () => {
  it('returns the input order untouched when nothing is ranked', () => {
    const keys = ['n1:/Island/Beach', 'n2:/Island/Beach']
    expect(applyOutputLayerOrder(keys, {}, nodePathOf)).toEqual(keys)
  })

  it('reorders two rival sinks that share a scene path', () => {
    const keys = ['n1:/Island/Beach', 'n2:/Island/Beach']
    const out = applyOutputLayerOrder(keys, { 'n2:/Island/Beach': 0, 'n1:/Island/Beach': 1 }, nodePathOf)
    expect(out).toEqual(['n2:/Island/Beach', 'n1:/Island/Beach'])
  })

  it('permutes only within the group\'s own slots, leaving other layers put', () => {
    const keys = [
      'n1:/Island',          // group '/'
      'n1:/Island/Beach',    // group '/Island'
      'n1:/Other',           // group '/'
      'n2:/Island/Beach',    // group '/Island'
    ]
    const out = applyOutputLayerOrder(keys, { 'n2:/Island/Beach': 0, 'n1:/Island/Beach': 1 }, nodePathOf)
    expect(out).toEqual([
      'n1:/Island',
      'n2:/Island/Beach',
      'n1:/Other',
      'n1:/Island/Beach',
    ])
  })

  it('keeps unranked siblings after ranked ones in their original order', () => {
    const keys = ['n1:/I/A', 'n2:/I/B', 'n3:/I/C']
    const out = applyOutputLayerOrder(keys, { 'n3:/I/C': 0 }, nodePathOf)
    expect(out).toEqual(['n3:/I/C', 'n1:/I/A', 'n2:/I/B'])
  })

  it('ignores ranks for keys that are no longer present', () => {
    const keys = ['n1:/I/A', 'n2:/I/B']
    const out = applyOutputLayerOrder(keys, { 'gone:/I/Z': 0, 'n2:/I/B': 1, 'n1:/I/A': 2 }, nodePathOf)
    expect(out).toEqual(['n2:/I/B', 'n1:/I/A'])
  })
})

describe('parentsBeforeChildren', () => {
  // Later in the array = higher layerIdx = painted last = ON TOP.
  const isAbove = (out: string[], a: string, b: string): boolean => out.indexOf(a) > out.indexOf(b)

  it('paints a child above its parent even when the parent arrives last', () => {
    const out = parentsBeforeChildren(['n1:/Island/Beach', 'n2:/Island'], nodePathOf)
    expect(isAbove(out, 'n1:/Island/Beach', 'n2:/Island')).toBe(true)
  })

  it('paints a child above a parent projected by a DIFFERENT sink', () => {
    const out = parentsBeforeChildren(
      ['n1:/Island/Beach/Shell', 'n2:/Island', 'n3:/Island/Beach'],
      nodePathOf,
    )
    expect(isAbove(out, 'n3:/Island/Beach', 'n2:/Island')).toBe(true)
    expect(isAbove(out, 'n1:/Island/Beach/Shell', 'n3:/Island/Beach')).toBe(true)
  })

  it('keeps every rival at a path below that path\'s children', () => {
    const out = parentsBeforeChildren(
      ['n1:/I/Beach', 'n1:/I/Beach/Shell', 'n2:/I/Beach'],
      nodePathOf,
    )
    expect(isAbove(out, 'n1:/I/Beach/Shell', 'n1:/I/Beach')).toBe(true)
    expect(isAbove(out, 'n1:/I/Beach/Shell', 'n2:/I/Beach')).toBe(true)
  })

  // The sibling axis carries the user's drag, so it must survive untouched.
  it('does NOT reverse siblings — a lower-listed sibling still paints on top', () => {
    const out = parentsBeforeChildren(['n1:/I/A', 'n1:/I/B'], nodePathOf)
    expect(out).toEqual(['n1:/I/A', 'n1:/I/B'])
  })

  it('does NOT reverse rival sinks sharing one path', () => {
    const out = parentsBeforeChildren(['n1:/I/Beach', 'n2:/I/Beach'], nodePathOf)
    expect(out).toEqual(['n1:/I/Beach', 'n2:/I/Beach'])
  })

  it('emits orphans whose intermediate path was never projected', () => {
    const out = parentsBeforeChildren(['n1:/A/B/C', 'n1:/A'], nodePathOf)
    expect(out).toHaveLength(2)
    expect(new Set(out)).toEqual(new Set(['n1:/A/B/C', 'n1:/A']))
  })

  it('keeps keys whose layer has vanished from the store', () => {
    const out = parentsBeforeChildren(['n1:/I/A', 'gone'], () => undefined)
    expect(out).toEqual(['n1:/I/A', 'gone'])
  })

  it('is a no-op on an empty list', () => {
    expect(parentsBeforeChildren([], nodePathOf)).toEqual([])
  })
})

describe('stackOrderHints', () => {
  const layers = (spec: Record<string, number[]>) => (key: string) => {
    const zs = spec[key]
    return zs ? { nodePath: nodePathOf(key), cells: zs.map((z) => ({ z })) } : undefined
  }

  it('warns when a reordered layer shares its z band with no sibling', () => {
    const keys = ['n1:/I/Ground', 'n2:/I/Cloud']
    const hints = stackOrderHints(keys, { 'n2:/I/Cloud': 0 }, layers({
      'n1:/I/Ground': [0, 1],
      'n2:/I/Cloud': [8, 9],
    }))
    expect(hints.has('n1:/I/Ground')).toBe(true)
    expect(hints.has('n2:/I/Cloud')).toBe(true)
    expect(hints.get('n2:/I/Cloud')).toContain('8–9')
  })

  it('stays quiet when the z bands overlap', () => {
    const keys = ['n1:/I/Beach', 'n2:/I/Beach']
    const hints = stackOrderHints(keys, { 'n2:/I/Beach': 0 }, layers({
      'n1:/I/Beach': [0, 2],
      'n2:/I/Beach': [1, 3],
    }))
    expect(hints.size).toBe(0)
  })

  it('stays quiet for groups the user never reordered', () => {
    const keys = ['n1:/I/Ground', 'n2:/I/Cloud']
    const hints = stackOrderHints(keys, {}, layers({
      'n1:/I/Ground': [0],
      'n2:/I/Cloud': [9],
    }))
    expect(hints.size).toBe(0)
  })

  it('does not warn about a lone layer with no sibling to tie with', () => {
    const hints = stackOrderHints(['n1:/I/Beach'], { 'n1:/I/Beach': 0 }, layers({ 'n1:/I/Beach': [0] }))
    expect(hints.size).toBe(0)
  })

  it('ignores layers with no cells to measure', () => {
    const keys = ['n1:/I/A', 'n2:/I/B']
    const hints = stackOrderHints(keys, { 'n1:/I/A': 0 }, (key) => (
      key === 'n1:/I/A' ? { nodePath: '/I/A', cells: [] } : { nodePath: '/I/B', cells: [{ z: 5 }] }
    ))
    expect(hints.has('n1:/I/A')).toBe(false)
  })
})

describe('reorderSibling', () => {
  const siblings = ['a', 'b', 'c']

  it('moves a key before a target and ranks the whole group', () => {
    expect(reorderSibling(siblings, 'c', 'a', 'before')).toEqual({ c: 0, a: 1, b: 2 })
  })

  it('moves a key after a target', () => {
    expect(reorderSibling(siblings, 'a', 'b', 'after')).toEqual({ b: 0, a: 1, c: 2 })
  })

  it('is a no-op when the target is missing', () => {
    expect(reorderSibling(siblings, 'a', 'zzz', 'before')).toEqual({})
  })
})
