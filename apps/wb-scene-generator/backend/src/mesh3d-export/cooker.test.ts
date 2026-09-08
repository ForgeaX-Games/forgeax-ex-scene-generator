import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { BakedLayer } from '../baked/store.js'
import { cookMesh3dScene } from './cooker.js'
import { MESH3D_SCENE_FORMAT, MESH3D_WORKBENCH_PREFIX } from './types.js'

const temps: string[] = []

afterEach(() => {
  for (const d of temps.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

function layer(partial: Partial<BakedLayer> & Pick<BakedLayer, 'assetType' | 'assetName' | 'cells'>): BakedLayer {
  return {
    nodePath: partial.nodePath ?? '/L',
    nodeName: partial.nodeName ?? 'L',
    value: partial.value ?? 1,
    assetName: partial.assetName,
    assetType: partial.assetType,
    cells: partial.cells,
    attributes: {},
  }
}

describe('cookMesh3dScene', () => {
  it('writes meta.json under wb-scene-generator/<sceneId> with package-relative paths', () => {
    const gameRoot = mkdtempSync(join(tmpdir(), 'mesh3d-export-'))
    temps.push(gameRoot)

    const layers: BakedLayer[] = [
      layer({
        nodePath: '/Ground',
        assetType: 'tile',
        assetName: 'Grass',
        cells: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 1 },
        ],
      }),
      layer({
        nodePath: '/Tree',
        assetType: 'object',
        assetName: 'firtree',
        cells: [{ x: 1, y: 0, z: 1, state: { instanceId: 't1' } }],
      }),
    ]

    const out = cookMesh3dScene({
      projectId: 'proj-demo',
      sceneId: 'proj-demo',
      sceneName: 'Demo',
      gameSlug: 'demo-game',
      gameRoot,
      layers,
      allowMissingAssets: true,
    })

    expect(out.relativeDir).toBe(`assets/3d/scenes/${MESH3D_WORKBENCH_PREFIX}/proj-demo`)
    expect(out.projectRelativeDir).toBe(`.forgeax/games/demo-game/assets/3d/scenes/${MESH3D_WORKBENCH_PREFIX}/proj-demo`)
    expect(existsSync(out.metaPath)).toBe(true)

    const meta = JSON.parse(readFileSync(out.metaPath, 'utf8')) as {
      format: string
      source: { workbench: string; projectId: string }
      terrain: { cells: Array<{ x: number; y: number; z: number; material: string }> }
      objects: Array<{ model: string; modelPath: string; position: { x: number; y: number; z: number } }>
      materials: Record<string, string>
      models: Record<string, string>
    }

    expect(meta.format).toBe(MESH3D_SCENE_FORMAT)
    expect(meta.source.workbench).toBe(MESH3D_WORKBENCH_PREFIX)
    expect(meta.source.projectId).toBe('proj-demo')
    expect(meta.terrain.cells).toHaveLength(3)
    expect(meta.terrain.cells.every((c) => c.material === 'Grass')).toBe(true)
    expect(meta.objects).toHaveLength(1)
    expect(meta.objects[0]!.position.z).toBeGreaterThan(0)

    // If Grass / firtree packs are installed locally, paths must resolve under the package.
    for (const rel of Object.values(meta.materials)) {
      expect(rel.startsWith('materials/')).toBe(true)
      expect(existsSync(join(out.sceneDir, rel))).toBe(true)
    }
    for (const rel of Object.values(meta.models)) {
      expect(rel.startsWith('models/')).toBe(true)
      expect(existsSync(join(out.sceneDir, rel))).toBe(true)
    }
  })

  it('rejects missing packs unless allowMissingAssets', () => {
    const gameRoot = mkdtempSync(join(tmpdir(), 'mesh3d-export-'))
    temps.push(gameRoot)
    const layers: BakedLayer[] = [
      layer({
        assetType: 'tile',
        assetName: '__no_such_material_xyz__',
        cells: [{ x: 0, y: 0, z: 0 }],
      }),
    ]
    expect(() => cookMesh3dScene({
      projectId: 'p',
      sceneId: 'p',
      sceneName: 'S',
      gameSlug: 'g',
      gameRoot,
      layers,
    })).toThrow(/missing material/)
  })
})
