import { describe, expect, it } from 'vitest'
import { orderBakedKeysForRender } from '../index'

// The returned array is back-to-front (later index = painted on top). The panel
// lists baked layers in pre-order DFS (parent above its indented children, first
// sibling on top), so render order must invert that: child over parent, and
// upper-listed sibling over lower-listed sibling.
describe('orderBakedKeysForRender', () => {
  it('paints children on top of their parent', () => {
    const out = orderBakedKeysForRender(['baked:/A', 'baked:/A/Sub'])
    // parent first (bottom), child last (top)
    expect(out).toEqual(['baked:/A', 'baked:/A/Sub'])
  })

  it('paints the upper-listed sibling on top of the lower one', () => {
    // panel order: /A (top), /B (bottom) → render bottom-to-top = [/B, /A]
    const out = orderBakedKeysForRender(['baked:/A', 'baked:/B'])
    expect(out).toEqual(['baked:/B', 'baked:/A'])
  })

  it('keeps whole subtrees stacked as a unit, child-over-parent within each', () => {
    // panel pre-order: A, A/1, A/2, B, B/1
    const out = orderBakedKeysForRender([
      'baked:/A', 'baked:/A/1', 'baked:/A/2', 'baked:/B', 'baked:/B/1',
    ])
    // back-to-front: B subtree below A subtree; within a subtree parent is below
    // its children and the first child ends up on top.
    expect(out).toEqual([
      'baked:/B', 'baked:/B/1', 'baked:/A', 'baked:/A/2', 'baked:/A/1',
    ])
    // sanity: every child outranks (later than) its parent
    const idx = (k: string): number => out.indexOf(k)
    expect(idx('baked:/A/1')).toBeGreaterThan(idx('baked:/A'))
    expect(idx('baked:/B/1')).toBeGreaterThan(idx('baked:/B'))
  })

  it('appends orphans (missing parent) rather than dropping them', () => {
    const out = orderBakedKeysForRender(['baked:/A/orphan'])
    expect(out).toEqual(['baked:/A/orphan'])
  })
})
