import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { assembleSceneBundle, writeSceneBundle } from '../src/scene-export/bundle.js'
import type { CookedScene } from '../src/scene-export/types.js'

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lxOB2wAAAABJRU5ErkJggg==',
  'base64',
)

function cooked(): CookedScene {
  return {
    bundleId: 'bundle-demo',
    sceneName: 'Bundle Demo',
    terrain: { version: '2.0', cols: 1, rows: 1, cells: { '0': [{ x: 0, y: 0, height: 0, template_id: ['grass'], graphic_index: [0] }] }, objects: [] },
    terrainConfig: { version: '2.0', templates: { grass: { terrain_type: 'base', region: 'default', water_body_id: null, base_pieces: 1, variant_prob: 0, graphic_id: [0], explore_speed_mod: 1, battle_move_cost: 1 } } },
    objectTypeConfig: { version: '2.0', types: {} },
    passabilityConfig: { version: '1.0', rules: [{ templateId: 'grass', passable: true }] },
    manifest: {
      schemaVersion: '3.0',
      bundleId: 'bundle-demo',
      generatedAt: '2026-06-04T06:00:00.000Z',
      generatedAtUtc: '2026-06-04T06:00:00.000Z',
      files: {
        terrain: 'terrain.json',
        terrainConfig: 'terrain-config.json',
        objectTypeConfig: 'object-type-config.json',
        passabilityConfig: 'passability-config.json',
        terrainAtlas: { tsj: 'terrain_atlas.tsj', image: 'terrain_atlas.png' },
        objectAtlas: { tsj: 'object_atlas.tsj', image: 'object_atlas.png' },
      },
    },
    warnings: [],
    terrainAtlasInputs: [],
    objectAtlasInputs: [],
  }
}

describe('scene bundle assembly', () => {
  it('includes the reference scene.zip file list', async () => {
    const zipBytes = await assembleSceneBundle({
      cooked: cooked(),
      atlases: {
        terrain: { png: pngBytes, tsj: { type: 'tileset', version: '1.10', name: 'terrain_atlas', image: 'terrain_atlas.png', imagewidth: 1, imageheight: 1, tilewidth: 16, tileheight: 16, tilecount: 1, columns: 0, tiles: [] } },
        object: { png: pngBytes, tsj: { type: 'tileset', version: '1.10', name: 'object_atlas', image: 'object_atlas.png', imagewidth: 1, imageheight: 1, tilewidth: 16, tileheight: 16, tilecount: 0, columns: 0, tiles: [] } },
      },
    })

    const zip = await JSZip.loadAsync(zipBytes)
    expect(Object.keys(zip.files).sort()).toEqual([
      'README.md',
      'area-tag-query.ts',
      'manifest.json',
      'object-type-config.json',
      'object_atlas.png',
      'object_atlas.tsj',
      'passability-config.json',
      'serve.bat',
      'serve.py',
      'serve.sh',
      'terrain-config.json',
      'terrain.json',
      'terrain_atlas.png',
      'terrain_atlas.tsj',
      'viewer.html',
      'viewer.js',
    ])
  })

  it('writes scene.zip and an unpacked mirror under exports/scene/bundleId', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'scene-export-bundle-'))
    const out = await writeSceneBundle({
      activeProjectDir: projectDir,
      cooked: cooked(),
      atlases: {
        terrain: { png: pngBytes, tsj: { type: 'tileset', version: '1.10', name: 'terrain_atlas', image: 'terrain_atlas.png', imagewidth: 1, imageheight: 1, tilewidth: 16, tileheight: 16, tilecount: 1, columns: 0, tiles: [] } },
        object: { png: pngBytes, tsj: { type: 'tileset', version: '1.10', name: 'object_atlas', image: 'object_atlas.png', imagewidth: 1, imageheight: 1, tilewidth: 16, tileheight: 16, tilecount: 0, columns: 0, tiles: [] } },
      },
    })

    expect(out.bundleId).toBe('bundle-demo')
    expect(existsSync(out.zipPath)).toBe(true)
    expect(existsSync(join(out.unpackedDir, 'terrain.json'))).toBe(true)
    expect(out.zipPath).toBe(join(projectDir, 'exports', 'scene', 'bundle-demo', 'scene.zip'))
  })
})
