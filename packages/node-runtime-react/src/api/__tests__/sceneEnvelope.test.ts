import { describe, expect, it } from 'vitest'

import { hydrateBlobRefs } from '../sceneEnvelope.js'

describe('hydrateBlobRefs', () => {
  it('is a no-op (same reference) when blobs is absent or empty', () => {
    const value = [{ path: [0], items: [{ focus: '/a' }] }]
    expect(hydrateBlobRefs(value, undefined)).toBe(value)
    expect(hydrateBlobRefs(value, {})).toBe(value)
  })

  it('replaces a top-level blob ref with the sidecar value', () => {
    const sceneTree = { name: 'root', cells: [{ x: 0, y: 0, z: 0, token: 'grass' }] }
    const value = [
      { path: [0], items: [{ tree: { __outputCacheBlobRef: 'hash1' }, focus: '/decor0' }] },
      { path: [1], items: [{ tree: { __outputCacheBlobRef: 'hash1' }, focus: '/decor1' }] },
    ]
    const hydrated = hydrateBlobRefs(value, { hash1: sceneTree }) as typeof value
    expect(hydrated[0]!.items[0]!.tree).toEqual(sceneTree)
    expect(hydrated[1]!.items[0]!.tree).toEqual(sceneTree)
    // Every branch got the same underlying sidecar value: fine within one
    // freshly-hydrated response (never mutated after hydration in this codebase).
    expect(hydrated[0]!.items[0]!.tree).toBe(hydrated[1]!.items[0]!.tree)
    // Unrelated fields pass through untouched.
    expect(hydrated[0]!.items[0]!.focus).toBe('/decor0')
  })

  it('resolves nested blob refs at any depth', () => {
    const value = { outer: { inner: { __outputCacheBlobRef: 'h' } } }
    expect(hydrateBlobRefs(value, { h: { deep: true } })).toEqual({ outer: { inner: { deep: true } } })
  })

  it('resolves a missing hash to undefined rather than throwing', () => {
    const value = { tree: { __outputCacheBlobRef: 'missing' } }
    expect(hydrateBlobRefs(value, { other: {} })).toEqual({ tree: undefined })
  })

  it('preserves arrays and primitives untouched', () => {
    const value = { list: [1, 'two', null, { a: { __outputCacheBlobRef: 'h' } }] }
    expect(hydrateBlobRefs(value, { h: 3 })).toEqual({ list: [1, 'two', null, { a: 3 }] })
  })
})
