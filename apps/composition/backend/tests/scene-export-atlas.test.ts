import { describe, expect, it } from 'vitest'
import { buildSceneAtlases } from '../src/scene-export/atlas.js'
import { cookBakedScene } from '../src/scene-export/cooker.js'
import type { BakedLayer } from '../src/baked/store.js'

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lxOB2wAAAABJRU5ErkJggg==',
  'base64',
)

function layer(partial: Partial<BakedLayer> & Pick<BakedLayer, 'nodePath' | 'nodeName'>): BakedLayer {
  return {
    value: 1,
    schema: 'tile',
    assetName: '',
    cells: [],
    attributes: {},
    ...partial,
  }
}

describe('buildSceneAtlases', () => {
  it('emits TSJ tile ids referenced by terrain and object configs', async () => {
    const cooked = cookBakedScene({
      bundleId: 'atlas-demo',
      sceneName: 'Atlas Demo',
      layers: [
        layer({
          nodePath: '/Ground',
          nodeName: 'Ground',
          assetName: 'Grass',
          assetAlias: 'grass-alias',
          assetType: 'tile',
          cells: [{ x: 0, y: 0, z: 0 }],
          attributes: { export_role: 'terrain', template_id: 'grass' },
        }),
        layer({
          nodePath: '/Tree',
          nodeName: 'Tree',
          assetName: 'Tree',
          assetAlias: 'tree-alias',
          assetType: 'object',
          cells: [{ x: 1, y: 0, z: 0 }],
          attributes: { export_role: 'object', object_type_id: 'tree' },
        }),
      ],
      aliases: [],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    const atlases = await buildSceneAtlases(cooked, {
      allowMissingAssets: false,
      resolveAssetContent: async (alias) => ({ bytes: pngBytes, mimeType: 'image/png', widthPx: alias === 'tree-alias' ? 16 : 1, heightPx: 1 }),
    })

    const terrainGraphic = cooked.terrainConfig.templates.grass!.graphic_id[0]
    const objectGraphic = cooked.objectTypeConfig.types.tree!.graphic
    expect(atlases.terrain.tsj.tiles.map((tile) => tile.id)).toContain(terrainGraphic)
    expect(atlases.object.tsj.tiles.map((tile) => tile.id)).toContain(objectGraphic)
    expect(atlases.terrain.png.length).toBeGreaterThan(0)
    expect(atlases.object.png.length).toBeGreaterThan(0)
  })

  it('writes the object pivot as the normalized anchor fraction (not divided by tile px)', async () => {
    // REGRESSION: anchorX/anchorY from asset metadata are ALREADY normalized
    // fractions in [0,1] (0.5 = center) — the same values the renderer feeds into
    // objectSpriteGridRect. atlas.ts previously divided them by tile width/height,
    // collapsing a 0.5 anchor on a 65px sprite to a ~0.0077 pivot and sliding every
    // multi-cell object off its anchor cell (the ambulance "sprawl" defect). The
    // pivot must equal the anchor fraction verbatim so the viewer's
    // (obj.x+0.5, obj.y+0.5) − pivot*spritePx placement matches the renderer.
    const cooked = cookBakedScene({
      bundleId: 'pivot-demo',
      sceneName: 'Pivot Demo',
      layers: [
        layer({
          nodePath: '/Van',
          nodeName: 'Van',
          assetName: 'Van',
          assetAlias: 'van-alias',
          assetType: 'object',
          cells: [{ x: 1, y: 0, z: 0 }],
          attributes: { export_role: 'object', object_type_id: 'van' },
        }),
      ],
      aliases: [
        { alias: 'van-alias', anchorX: 0.5, anchorY: 0.2, widthPx: 65, heightPx: 48 },
      ],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    const atlases = await buildSceneAtlases(cooked, {
      allowMissingAssets: false,
      resolveAssetContent: async () => ({ bytes: pngBytes, mimeType: 'image/png', widthPx: 65, heightPx: 48 }),
    })

    const objectGraphic = cooked.objectTypeConfig.types.van!.graphic
    const tile = atlases.object.tsj.tiles.find((t) => t.id === objectGraphic)!
    expect(tile.width).toBe(65)
    expect(tile.height).toBe(48)
    // Verbatim anchor fractions — NOT 0.5/65 ≈ 0.0077 or 0.2/48 ≈ 0.0042.
    expect(tile.pivot.x).toBeCloseTo(0.5, 6)
    expect(tile.pivot.y).toBeCloseTo(0.2, 6)
  })

  it('fails missing alias content unless fallback output is explicitly allowed', async () => {
    const cooked = cookBakedScene({
      bundleId: 'missing-demo',
      sceneName: 'Missing Demo',
      layers: [
        layer({
          nodePath: '/Ground',
          nodeName: 'Ground',
          assetName: 'Grass',
          assetAlias: 'missing-alias',
          assetType: 'tile',
          cells: [{ x: 0, y: 0, z: 0 }],
          attributes: { export_role: 'terrain', template_id: 'grass' },
        }),
      ],
      aliases: [],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    await expect(buildSceneAtlases(cooked, {
      allowMissingAssets: false,
      resolveAssetContent: async () => null,
    })).rejects.toThrow(/missing asset/i)
  })
})
