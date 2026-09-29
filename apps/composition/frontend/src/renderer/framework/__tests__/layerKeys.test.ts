import { describe, expect, it } from 'vitest'
import { mergeRenderableVoxelLayerKeys } from '../layerKeys'

describe('renderable layer keys', () => {
  it('keeps graph output layers below editable baked layers for all renderer modes', () => {
    expect(mergeRenderableVoxelLayerKeys(['out:/Ground'], ['baked:/Paint'])).toEqual([
      'out:/Ground',
      'baked:/Paint',
    ])
  })

  it('preserves empty buckets without special-casing in plugins', () => {
    expect(mergeRenderableVoxelLayerKeys([], ['baked:/Only'])).toEqual(['baked:/Only'])
    expect(mergeRenderableVoxelLayerKeys(['out:/Only'], [])).toEqual(['out:/Only'])
  })
})
