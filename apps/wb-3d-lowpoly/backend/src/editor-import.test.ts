import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENGINE_ASSET_DIRECTORY,
  buildEngineGlbPath,
  normalizeEngineAssetDirectory,
  normalizeGlbFilename,
} from './editor-import.js'

describe('lowpoly Editor import contract', () => {
  it('builds a deterministic project-relative GLB path', () => {
    expect(normalizeEngineAssetDirectory(undefined)).toBe(DEFAULT_ENGINE_ASSET_DIRECTORY)
    expect(normalizeGlbFilename('robot.glb')).toBe('robot.glb')
    expect(buildEngineGlbPath('assets/models', 'robot')).toEqual({
      directory: 'assets/models',
      sourceName: 'robot.glb',
      destPath: 'assets/models/robot.glb',
    })
  })

  it('rejects path traversal before invoking the Editor capability', () => {
    expect(() => normalizeEngineAssetDirectory('../outside')).toThrow()
    expect(() => normalizeEngineAssetDirectory('assets/../outside')).toThrow()
    expect(() => normalizeEngineAssetDirectory('/tmp/output')).toThrow()
  })
})
