import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENGINE_ASSET_DIRECTORY,
  normalizeEngineAssetDirectory,
  normalizeEngineGlbFilename,
} from '../direct-engine-import'

describe('direct engine import destination', () => {
  it('defaults to the project 3D asset directory and normalizes separators', () => {
    expect(normalizeEngineAssetDirectory('')).toBe(DEFAULT_ENGINE_ASSET_DIRECTORY)
    expect(normalizeEngineAssetDirectory('assets\\models/')).toBe('assets/models')
    expect(normalizeEngineGlbFilename('asset.glb')).toBe('asset.glb')
  })

  it('rejects traversal in a project-relative directory', () => {
    expect(() => normalizeEngineAssetDirectory('../outside')).toThrow()
    expect(() => normalizeEngineAssetDirectory('assets/../outside')).toThrow()
  })

  it('keeps a single glb extension and strips path segments from filenames', () => {
    expect(normalizeEngineGlbFilename('robot.glb')).toBe('robot.glb')
    expect(normalizeEngineGlbFilename('folder/robot')).toBe('robot.glb')
  })
})
