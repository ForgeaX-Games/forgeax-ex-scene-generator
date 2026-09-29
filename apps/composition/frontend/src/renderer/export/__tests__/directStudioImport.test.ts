import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STUDIO_ASSET_DIRECTORY,
  normalizeStudioAssetDirectory,
  normalizeStudioGlbFilename,
} from '../directStudioImport.js'

describe('direct Studio GLB import destination', () => {
  it('uses the game 3D asset directory by default and normalizes separators', () => {
    expect(normalizeStudioAssetDirectory('')).toBe(DEFAULT_STUDIO_ASSET_DIRECTORY)
    expect(normalizeStudioAssetDirectory('assets\\models/')).toBe('assets/models')
    expect(normalizeStudioGlbFilename('baked-scene.glb')).toBe('baked-scene.glb')
  })

  it('rejects absolute paths and traversal', () => {
    expect(() => normalizeStudioAssetDirectory('/assets/3d')).toThrow()
    expect(() => normalizeStudioAssetDirectory('../outside')).toThrow()
    expect(() => normalizeStudioAssetDirectory('assets/../outside')).toThrow()
  })

  it('normalizes the filename to a single GLB extension', () => {
    expect(normalizeStudioGlbFilename('folder/baked voxel')).toBe('baked_voxel.glb')
    expect(normalizeStudioGlbFilename('baked.glb')).toBe('baked.glb')
  })
})
