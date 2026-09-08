import { describe, expect, it } from 'vitest'
import { dedupeBakePaths } from '../bakePaths'

describe('dedupeBakePaths', () => {
  it('leaves a single sink untouched', () => {
    const out = dedupeBakePaths([
      { nodeId: 'n1', nodePath: '/Island' },
      { nodeId: 'n1', nodePath: '/Island/Beach' },
    ])
    expect(out.map((o) => o.nodePath)).toEqual(['/Island', '/Island/Beach'])
  })

  // Two parallel scene_output sinks both baked at once: the backend only renames
  // the ROOT segment, so without this the second /Island/Beach would overwrite
  // the first.
  it('renames the colliding leaf of a rival sink', () => {
    const out = dedupeBakePaths([
      { nodeId: 'n1', nodePath: '/Island/Beach' },
      { nodeId: 'n2', nodePath: '/Island/Beach' },
      { nodeId: 'n3', nodePath: '/Island/Beach' },
    ])
    expect(out.map((o) => o.nodePath)).toEqual([
      '/Island/Beach',
      '/Island/Beach 2',
      '/Island/Beach 3',
    ])
  })

  it('carries a renamed parent down to its own children', () => {
    const out = dedupeBakePaths([
      { nodeId: 'n1', nodePath: '/Island' },
      { nodeId: 'n1', nodePath: '/Island/Rest' },
      { nodeId: 'n2', nodePath: '/Island' },
      { nodeId: 'n2', nodePath: '/Island/Rest' },
    ])
    expect(out.map((o) => o.nodePath)).toEqual([
      '/Island',
      '/Island/Rest',
      '/Island 2',
      '/Island 2/Rest',
    ])
  })

  // A rival sink's child whose parent was NOT selected still nests under the
  // inherited (byte-identical) ancestor that was.
  it('falls back to another sink’s mapping when the parent is not in the batch', () => {
    const out = dedupeBakePaths([
      { nodeId: 'n1', nodePath: '/Island' },
      { nodeId: 'n2', nodePath: '/Island/Beach' },
    ])
    expect(out.map((o) => o.nodePath)).toEqual(['/Island', '/Island/Beach'])
  })
})
