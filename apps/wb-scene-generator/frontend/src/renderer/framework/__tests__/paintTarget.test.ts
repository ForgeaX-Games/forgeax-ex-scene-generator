import { describe, expect, it } from 'vitest'
import { defaultPaintTargetName, resolvePaintTargetSync } from '../paintTarget'

describe('paint target resolution', () => {
  it('uses the active layer when it is unbound or already bound to the paint asset', () => {
    expect(resolvePaintTargetSync({
      activeKey: 'baked:/Floor',
      activeAssetName: '',
      paintAssetName: 'grass',
    })).toEqual({ kind: 'use-active', key: 'baked:/Floor' })

    expect(resolvePaintTargetSync({
      activeKey: 'baked:/Floor',
      activeAssetName: 'grass',
      paintAssetName: 'grass',
    })).toEqual({ kind: 'use-active', key: 'baked:/Floor' })
  })

  it('requires user confirmation when the active layer has a different asset', () => {
    expect(resolvePaintTargetSync({
      activeKey: 'baked:/Floor',
      activeAssetName: 'stone',
      paintAssetName: 'grass',
    })).toEqual({ kind: 'needs-confirmation' })
  })

  it('suggests a readable new layer name from the paint asset', () => {
    expect(defaultPaintTargetName('grass')).toBe('grass')
    expect(defaultPaintTargetName('')).toBe('Layer')
    expect(defaultPaintTargetName('wall/trim')).toBe('wall trim')
  })
})
