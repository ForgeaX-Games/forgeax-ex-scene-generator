// 💡 Shared-resolver tests for the cooker's per-cell tile resolution.
//
// The exported `graphic_index` MUST equal the sprite the RENDERER actually
// draws. After unification there is ONE implementation of that pick — the
// renderer's `pickFaceSpriteIndex` (modes/topBillboard/buildVoxelMaster/
// pickFaceSprite.ts) — and the cooker CALLS it via the vendored bundle
// `vendor/dist/renderer-resolve/...` (the SAME emitted module, no parallel
// backend re-derivation). These tests cook a scene and run that SAME shared
// resolver over the same neighbourhood, asserting the cook's index equals the
// shared resolver's — including the `edgeDist2` / `adjacent8` keyModes and the
// front-wall face. Importing from the vendored bundle (not a second frontend
// import) is deliberate: it is the exact module the export path executes, so a
// match proves "export === shared resolver" by construction.

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { cookBakedScene } from '../src/scene-export/cooker.js'
import { loadTileRule, setRulesDir, computeValidTopVariantPoolsByTileId, type TileRule } from '../src/scene-export/tileRules.js'
import type { BakedLayer } from '../src/baked/store.js'
import {
  computeValidVariantIdxs,
  computeValidVariantPoolsByTileId,
  pickFaceSpriteIndex,
  type CollectedCell,
  type FaceRule,
} from '../../vendor/dist/renderer-resolve/renderer/server/spriteResolver.js'

function baseLayer(partial: Partial<BakedLayer> & Pick<BakedLayer, 'nodePath' | 'nodeName'>): BakedLayer {
  return { value: 1, schema: 'tile', assetName: '', cells: [], attributes: {}, ...partial }
}

/** Run the SHARED resolver (the exact module the cook uses) for the TOP face. */
function rendererTopIndex(
  rule: TileRule,
  cell: { x: number; y: number; z: number },
  coords: Set<string>,
): number {
  const cc: CollectedCell = { x: cell.x, y: cell.y, z: cell.z, layerIdx: 0 }
  return pickFaceSpriteIndex({
    face: rule.faces.top! as unknown as FaceRule,
    faceTag: 'top',
    sprites: rule.sprites,
    validVariantIdxs: [],
    cell: cc,
    coordsByLayerIdx: new Map([[0, coords]]),
    regions: new Map(),
  })
}

/** Same, for the FRONT face (billboard front-wall sprite resolution). */
function rendererFrontIndex(
  rule: TileRule,
  cell: { x: number; y: number; z: number },
  coords: Set<string>,
): number {
  const cc: CollectedCell = { x: cell.x, y: cell.y, z: cell.z, layerIdx: 0 }
  return pickFaceSpriteIndex({
    face: rule.faces.front! as unknown as FaceRule,
    faceTag: 'front',
    sprites: rule.sprites,
    validVariantIdxs: [],
    cell: cc,
    coordsByLayerIdx: new Map([[0, coords]]),
    regions: new Map(),
  })
}

describe('cookBakedScene renderer parity', () => {
  let rulesDir: string | undefined
  afterEach(() => {
    setRulesDir(undefined)
    if (rulesDir) rmSync(rulesDir, { recursive: true, force: true })
    rulesDir = undefined
  })

  function writeRule(name: string, rule: unknown): void {
    rulesDir = rulesDir ?? mkdtempSync(join(tmpdir(), 'scene-parity-'))
    writeFileSync(join(rulesDir, `${name}.json`), JSON.stringify(rule))
    setRulesDir(rulesDir)
  }

  it('honours edgeDist2 keyMode (6-tuple key) exactly like the renderer', () => {
    // A 3-row vertical strip: a true edgeDist2 rule distinguishes the head row
    // (no up neighbour), the middle row (up & down at dist 1, none at dist 2),
    // and the tail row (no down neighbour). A 4-tuple fork CANNOT tell head/mid
    // apart when both have an up & down neighbour at distance 1.
    writeRule('bridge_test', {
      schemaVersion: 2,
      ppu: 16,
      sprites: [
        { x: 0, y: 0, w: 16, h: 16 },   // 0 head
        { x: 16, y: 0, w: 16, h: 16 },  // 1 middle
        { x: 32, y: 0, w: 16, h: 16 },  // 2 tail
      ],
      faces: {
        top: {
          basePieces: 3,
          keyMode: 'edgeDist2',
          map: {
            '0,1,0,0,0,1': 0, // head: up absent at dist 1; down present at dist 1 & 2
            '1,1,0,0,0,0': 1, // middle: up & down at dist 1, neither at dist 2
            '1,0,0,0,1,0': 2, // tail: down absent at dist 1; up present at dist 1 & 2
            '*,*,*,*,*,*': 1,
          },
        },
      },
    })

    const cells = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 2, z: 0 },
    ]
    const result = cookBakedScene({
      bundleId: 'b',
      sceneName: 'S',
      layers: [baseLayer({
        nodePath: '/W/Bridge', nodeName: 'Bridge',
        assetName: 'Bridge', assetAlias: 'bridge-sheet', assetType: 'tile',
        cells,
        attributes: { export_role: 'terrain', template_id: 'bridge' },
      })],
      aliases: [{ alias: 'bridge-sheet', tileType: 'bridge_test' }],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    const rule = loadTileRule('bridge_test')!
    const coords = new Set(cells.map((c) => `${c.x},${c.y},${c.z}`))
    // After cook's non-negative offset, z=0 strip y=0..2 lands at screen y=0..2.
    const byY = (y: number) => result.terrain.cells['0']!.find((c) => c.y === y)!.graphic_index[0]
    expect(byY(0)).toBe(0)
    expect(byY(1)).toBe(1)
    expect(byY(2)).toBe(2)
    for (const c of cells) {
      expect(byY(c.y)).toBe(rendererTopIndex(rule, c, coords))
    }
  })

  it('honours edgeDist4 keyMode (8-tuple key) exactly like the renderer', () => {
    // A 3-column horizontal strip: a true edgeDist4 rule distinguishes the left
    // head (no left neighbour), the middle (left & right at dist 1, none at dist
    // 2), and the right tail (no right neighbour) via the horizontal dist-2 probes
    // left2/right2 — which edgeDist2 (vertical only) CANNOT tell apart.
    writeRule('road_test', {
      schemaVersion: 2,
      ppu: 16,
      sprites: [
        { x: 0, y: 0, w: 16, h: 16 },   // 0 left head
        { x: 16, y: 0, w: 16, h: 16 },  // 1 middle
        { x: 32, y: 0, w: 16, h: 16 },  // 2 right tail
      ],
      faces: {
        top: {
          basePieces: 3,
          keyMode: 'edgeDist4',
          map: {
            '0,0,0,1,0,0,0,1': 0, // left head: left absent; right present at dist 1 & 2
            '0,0,1,1,0,0,0,0': 1, // middle: left & right at dist 1, neither at dist 2
            '0,0,1,0,0,0,1,0': 2, // right tail: right absent; left present at dist 1 & 2
            '*,*,*,*,*,*,*,*': 1,
          },
        },
      },
    })

    const cells = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ]
    const result = cookBakedScene({
      bundleId: 'b',
      sceneName: 'S',
      layers: [baseLayer({
        nodePath: '/W/Road', nodeName: 'Road',
        assetName: 'Road', assetAlias: 'road-sheet', assetType: 'tile',
        cells,
        attributes: { export_role: 'terrain', template_id: 'road' },
      })],
      aliases: [{ alias: 'road-sheet', tileType: 'road_test' }],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    const rule = loadTileRule('road_test')!
    const coords = new Set(cells.map((c) => `${c.x},${c.y},${c.z}`))
    const byX = (x: number) => result.terrain.cells['0']!.find((c) => c.x === x)!.graphic_index[0]
    expect(byX(0)).toBe(0)
    expect(byX(1)).toBe(1)
    expect(byX(2)).toBe(2)
    for (const c of cells) {
      expect(byX(c.x)).toBe(rendererTopIndex(rule, c, coords))
    }
  })

  it('routes face.variants by when.stateEquals from per-cell state (slopeDir dispatch)', () => {
    // slope_24-style dispatch: a per-cell tag (cell.state.slopeDir) selects one of
    // several parallel maps. The rule needs NO neighbours to differ — the tag alone
    // routes the map. Isolated cells all share neighbour key "0,0,0,0"; only the tag
    // changes which map's "0,0,0,0" entry wins.
    writeRule('slope_test', {
      schemaVersion: 2,
      ppu: 16,
      sprites: [
        { x: 0, y: 0, w: 16, h: 16 },   // 0 back (default)
        { x: 16, y: 0, w: 16, h: 16 },  // 1 front
        { x: 32, y: 0, w: 16, h: 16 },  // 2 left
      ],
      faces: {
        top: {
          basePieces: 3,
          map: { '0,0,0,0': 0 },
          variants: [
            { when: { stateEquals: { key: 'slopeDir', value: 'front' } }, map: { '0,0,0,0': 1 } },
            { when: { stateEquals: { key: 'slopeDir', value: 'left' } }, map: { '0,0,0,0': 2 } },
          ],
        },
      },
    })

    // Three isolated cells (far apart so each has no same-layer neighbour) with
    // different tags: absent → default(0), 'front' → 1, 'left' → 2.
    const cells = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0, state: { slopeDir: 'front' } },
      { x: 20, y: 0, z: 0, state: { slopeDir: 'left' } },
    ]
    const result = cookBakedScene({
      bundleId: 'b',
      sceneName: 'S',
      layers: [baseLayer({
        nodePath: '/W/Slope', nodeName: 'Slope',
        assetName: 'Slope', assetAlias: 'slope-sheet', assetType: 'tile',
        cells,
        attributes: { export_role: 'terrain', template_id: 'slope' },
      })],
      aliases: [{ alias: 'slope-sheet', tileType: 'slope_test' }],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    const rule = loadTileRule('slope_test')!
    const byX = (x: number) => result.terrain.cells['0']!.find((c) => c.x === x)!.graphic_index[0]
    expect(byX(0)).toBe(0)
    expect(byX(10)).toBe(1)
    expect(byX(20)).toBe(2)
    // Parity: the shared resolver picks the same index when given the cell's state.
    for (const c of cells) {
      const cc: CollectedCell = { x: c.x, y: c.y, z: c.z, layerIdx: 0, ...('state' in c ? { state: c.state } : {}) }
      const idx = pickFaceSpriteIndex({
        face: rule.faces.top! as unknown as FaceRule,
        faceTag: 'top',
        sprites: rule.sprites,
        validVariantIdxs: [],
        cell: cc,
        coordsByLayerIdx: new Map([[0, new Set([`${c.x},${c.y},${c.z}`])]]),
        regions: new Map(),
      })
      expect(byX(c.x)).toBe(idx)
    }
  })

  it('honours adjacent8 keyMode (8-tuple key) exactly like the renderer', () => {
    // Probe (0,1): orthogonal u+r. Without diagonal (1,0) → tip tile 0;
    // with ur=(1,0) present → elbow tile 1. adjacent4 cannot tell these apart.
    writeRule('bridge8_test', {
      schemaVersion: 2,
      ppu: 16,
      sprites: [
        { x: 0, y: 0, w: 16, h: 16 },
        { x: 16, y: 0, w: 16, h: 16 },
      ],
      faces: {
        top: {
          basePieces: 2,
          keyMode: 'adjacent8',
          map: {
            '1,0,0,1,0,1,0,0': 1, // u+r + ur
            '1,0,0,1,0,0,0,0': 0, // u+r, no diagonals
            '*,*,*,*,*,*,*,*': 0,
          },
        },
      },
    })

    const probe = { x: 0, y: 1, z: 0 }
    const cellsTip = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 },
    ]
    const cellsElbow = [...cellsTip, { x: 1, y: 0, z: 0 }]
    const coordsTip = new Set(cellsTip.map((c) => `${c.x},${c.y},${c.z}`))
    const coordsElbow = new Set(cellsElbow.map((c) => `${c.x},${c.y},${c.z}`))
    const rule = loadTileRule('bridge8_test')!

    const cook = (cells: Array<{ x: number; y: number; z: number }>) =>
      cookBakedScene({
        bundleId: 'b',
        sceneName: 'S',
        layers: [baseLayer({
          nodePath: '/W/Bridge8', nodeName: 'Bridge8',
          assetName: 'Bridge8', assetAlias: 'bridge8-sheet', assetType: 'tile',
          cells,
          attributes: { export_role: 'terrain', template_id: 'bridge8' },
        })],
        aliases: [{ alias: 'bridge8-sheet', tileType: 'bridge8_test' }],
        generatedAt: new Date('2026-06-04T06:00:00.000Z'),
      })

    const tipRow = probe.y // z=0 + cook non-neg offset → screen y === source y
    const tipCell = cook(cellsTip).terrain.cells['0']!.find((e) => e.x === probe.x && e.y === tipRow)!
    expect(tipCell.graphic_index[0]).toBe(0)
    expect(tipCell.graphic_index[0]).toBe(rendererTopIndex(rule, probe, coordsTip))

    const elbowCell = cook(cellsElbow).terrain.cells['0']!.find((e) => e.x === probe.x && e.y === tipRow)!
    expect(elbowCell.graphic_index[0]).toBe(1)
    expect(elbowCell.graphic_index[0]).toBe(rendererTopIndex(rule, probe, coordsElbow))
  })

  it('matches the renderer pickFaceSprite for a 2D adjacency block', () => {
    writeRule('common_test2', {
      schemaVersion: 2,
      ppu: 16,
      sprites: [
        { x: 0, y: 0, w: 16, h: 16 },
        { x: 16, y: 0, w: 16, h: 16 },
        { x: 32, y: 0, w: 16, h: 16 },
        { x: 48, y: 0, w: 16, h: 16 },
        { x: 0, y: 16, w: 16, h: 16 },
      ],
      faces: {
        top: {
          basePieces: 5,
          map: {
            '0,0,0,0': 0,
            '0,1,0,1': 1, // top-left corner (down + right neighbours)
            '0,1,1,1': 2, // top edge
            '1,1,1,1': 3, // interior
            '*,*,*,*': 4,
          },
        },
      },
    })

    // 3x3 filled block → corners/edges/centre exercise multiple keys.
    const cells: Array<{ x: number; y: number; z: number }> = []
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) cells.push({ x, y, z: 0 })

    const result = cookBakedScene({
      bundleId: 'b', sceneName: 'S',
      layers: [baseLayer({
        nodePath: '/W/G', nodeName: 'G',
        assetName: 'G', assetAlias: 'g-sheet', assetType: 'tile',
        cells, attributes: { export_role: 'terrain', template_id: 'g' },
      })],
      aliases: [{ alias: 'g-sheet', tileType: 'common_test2' }],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    const rule = loadTileRule('common_test2')!
    const coords = new Set(cells.map((c) => `${c.x},${c.y},${c.z}`))
    const emitted = result.terrain.cells['0']!
    for (const c of cells) {
      const got = emitted.find((e) => e.x === c.x && e.y === c.y)!.graphic_index[0]
      expect(got).toBe(rendererTopIndex(rule, c, coords))
    }
  })

  it('resolves the FRONT-wall sprite exactly like the renderer pickFaceSprite (front face)', () => {
    // A 3-tall wall column. The front face key is (t,b,l,r) where t/b probe the
    // z-axis (voxel above/below) and l/r the x-axis. Distinct map entries per
    // vertical position let us assert the backend front pick == renderer front pick.
    writeRule('wall_front_test', {
      schemaVersion: 2,
      ppu: 16,
      sprites: [
        { x: 0, y: 0, w: 16, h: 16 },   // top sprite
        { x: 16, y: 0, w: 16, h: 16 },  // front: bottom of column (no b)
        { x: 32, y: 0, w: 16, h: 16 },  // front: middle (t & b)
        { x: 48, y: 0, w: 16, h: 16 },  // front: top of column (no t)
      ],
      faces: {
        top: { basePieces: 4, map: { '*,*,*,*': 0 } },
        front: {
          basePieces: 4,
          // key = t,b,l,r (t/b = up/down on z, l/r = neighbours on x)
          map: {
            '1,0,0,0': 1, // has voxel above, none below → bottom of column
            '1,1,0,0': 2, // sandwiched → middle
            '0,1,0,0': 3, // none above, voxel below → top of column
            '*,*,*,*': 1,
          },
        },
      },
    })

    const cells = [
      { x: 0, y: 5, z: 0 },
      { x: 0, y: 5, z: 1 },
      { x: 0, y: 5, z: 2 },
    ]
    const result = cookBakedScene({
      bundleId: 'b', sceneName: 'S',
      layers: [baseLayer({
        nodePath: '/W/Wall', nodeName: 'Wall',
        assetName: 'Wall', assetAlias: 'wall-sheet', assetType: 'tile',
        cells, attributes: { export_role: 'terrain', template_id: 'wall' },
      })],
      aliases: [{ alias: 'wall-sheet', tileType: 'wall_front_test' }],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    const rule = loadTileRule('wall_front_test')!
    const coords = new Set(cells.map((c) => `${c.x},${c.y},${c.z}`))

    // For each voxel, the FRONT-wall cell lives in group z at screen row y-z.
    // Identify it by a graphic_index that is NOT the top sprite (idx 0).
    for (const c of cells) {
      const group = result.terrain.cells[String(c.z)]!
      const frontRow = c.y - c.z
      const frontCells = group.filter((e) => e.x === c.x && e.y === frontRow)
      // pick the layer whose sprite differs from the flat top cap (idx 0)
      const frontGi = frontCells.flatMap((e) => e.graphic_index).find((gi) => gi !== 0)
      expect(frontGi).toBe(rendererFrontIndex(rule, c, coords))
    }
  })

  it('honours front.blockVariants (3x3 solid-block big-sprite override) exactly like the renderer', () => {
    // A 6-wide x 3-tall solid wall = TWO world-grid-aligned 3x3 megacells
    // (anchors x=0 and x=3). probability:1 makes the override deterministic;
    // group [1..9] is distinguishable from the fallback sprite (idx 0).
    writeRule('wall_block_test', {
      schemaVersion: 2,
      ppu: 16,
      sprites: [
        { x: 0, y: 0, w: 16, h: 16 }, // 0: fallback (non-solid-window front pick)
        { x: 16, y: 0, w: 16, h: 16 }, { x: 32, y: 0, w: 16, h: 16 }, { x: 48, y: 0, w: 16, h: 16 },
        { x: 0, y: 16, w: 16, h: 16 }, { x: 16, y: 16, w: 16, h: 16 }, { x: 32, y: 16, w: 16, h: 16 },
        { x: 0, y: 32, w: 16, h: 16 }, { x: 16, y: 32, w: 16, h: 16 }, { x: 32, y: 32, w: 16, h: 16 },
      ],
      faces: {
        top: { basePieces: 1, map: { '*,*,*,*': 0 } },
        front: {
          basePieces: 1,
          map: { '*,*,*,*': 0 },
          blockVariants: { probability: 1, groups: [[1, 2, 3, 4, 5, 6, 7, 8, 9]] },
        },
      },
    })

    const y = 5
    const cells: Array<{ x: number; y: number; z: number }> = []
    for (let z = 0; z < 3; z++) for (let x = 0; x < 6; x++) cells.push({ x, y, z })
    // Break the LEFT megacell (anchor x=0) only — its window is no longer fully
    // solid, so it must fall back to the default map pick (idx 0); the RIGHT
    // megacell (anchor x=3) stays solid and must get the block-variant sprite.
    const solidCells = cells.filter((c) => !(c.x === 1 && c.z === 1))

    const rule = loadTileRule('wall_block_test')!
    const coords = new Set(solidCells.map((c) => `${c.x},${c.y},${c.z}`))

    const result = cookBakedScene({
      bundleId: 'b', sceneName: 'S',
      layers: [baseLayer({
        nodePath: '/W/WallBlock', nodeName: 'WallBlock',
        assetName: 'WallBlock', assetAlias: 'wallblock-sheet', assetType: 'tile',
        cells: solidCells, attributes: { export_role: 'terrain', template_id: 'wallblock' },
      })],
      aliases: [{ alias: 'wallblock-sheet', tileType: 'wall_block_test' }],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })

    for (const c of solidCells) {
      const group = result.terrain.cells[String(c.z)]!
      const frontRow = c.y - c.z
      const frontCells = group.filter((e) => e.x === c.x && e.y === frontRow)
      const frontGi = frontCells.flatMap((e) => e.graphic_index).find((gi) => gi !== 0) ?? 0
      expect(frontGi).toBe(rendererFrontIndex(rule, c, coords))
    }

    // Left megacell (anchor x=0) not solid → fallback idx 0 for every one of its cells.
    for (const c of solidCells.filter((c) => c.x < 3)) {
      expect(rendererFrontIndex(rule, c, coords)).toBe(0)
    }
    // Right megacell (anchor x=3) solid → each local (x-3, z) maps to group[z*3+(x-3)].
    for (const c of solidCells.filter((c) => c.x >= 3)) {
      const localX = c.x - 3
      expect(rendererFrontIndex(rule, c, coords)).toBe(1 + (c.z * 3 + localX))
    }
  })
})

// ── Parser parity: backend parseRule accepts every shipped rule + advanced fields ──
describe('parseRule shipped-rule parity', () => {
  afterEach(() => setRulesDir(undefined))

  it('parses every shipped rule file into a NormalizedRule with advanced fields intact', () => {
    setRulesDir(undefined) // default = apps/wb-scene-generator/assets/rules
    // bridge_25: adjacent8 keyMode + faces.entry for bridge end caps.
    const bridge = loadTileRule('bridge_25')
    expect(bridge).not.toBeNull()
    expect(bridge!.faces.top?.keyMode).toBe('adjacent8')
    expect(bridge!.faces.entry?.keyMode).toBe('adjacent8')
    expect(bridge!.sprites).toHaveLength(125)
    expect(Object.keys(bridge!.faces.top!.map).every((k) => k.split(',').length === 8)).toBe(true)
    expect(Object.keys(bridge!.faces.entry!.map).every((k) => k.split(',').length === 8)).toBe(true)
    expect(bridge!.faces.entry?.randomRules?.length).toBe(12)

    // common_16: per-tileId randomRules must survive.
    const common = loadTileRule('common_16')
    expect(common).not.toBeNull()
    expect(common!.faces.top?.randomRules?.length).toBeGreaterThan(0)
    expect(common!.faces.top?.randomRules?.[0]?.variantIdxs?.length).toBe(4)

    // inner_wall_27: front.blockVariants (3 candidate groups of 9) must survive.
    const innerWall = loadTileRule('inner_wall_27')
    expect(innerWall).not.toBeNull()
    expect(innerWall!.sprites).toHaveLength(162)
    const blockVariants = innerWall!.faces.front?.blockVariants
    expect(blockVariants?.groups).toHaveLength(3)
    expect(blockVariants?.groups.every((g) => g.length === 9)).toBe(true)
    expect(blockVariants?.probability).toBeGreaterThan(0)
  })
})

// ── Pixel-filtered variant candidates (parity with bindings.computeValidVariantIdxs) ──
describe('cookBakedScene variant pixel filtering', () => {
  let rulesDir: string | undefined
  afterEach(() => {
    setRulesDir(undefined)
    if (rulesDir) rmSync(rulesDir, { recursive: true, force: true })
    rulesDir = undefined
  })

  it('drops transparent variant slots before randomRules sampling', () => {
    rulesDir = mkdtempSync(join(tmpdir(), 'scene-variant-'))
    // base sprite 0; variant slots 1,2,3 — but only slot 2 has visible pixels.
    // keepProbability 0 forces the randomRules branch to ALWAYS pick a variant,
    // so a single isolated cell must land on the one non-transparent slot (2).
    writeFileSync(join(rulesDir, 'variant_test.json'), JSON.stringify({
      schemaVersion: 2,
      ppu: 16,
      sprites: [
        { x: 0, y: 0, w: 16, h: 16 },
        { x: 16, y: 0, w: 16, h: 16 },
        { x: 32, y: 0, w: 16, h: 16 },
        { x: 48, y: 0, w: 16, h: 16 },
      ],
      faces: {
        top: {
          basePieces: 1,
          variantIdxs: [1, 2, 3],
          randomRules: [{ tileId: 0, keepProbability: 0 }],
          map: { '*,*,*,*': 0 },
        },
      },
    }))
    setRulesDir(rulesDir)

    // 64px-wide sheet, all transparent EXCEPT the slot-2 rect (x=32..47).
    const w = 64, h = 16
    const data = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) {
      for (let x = 32; x < 48; x++) {
        const i = (y * w + x) * 4
        data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255
      }
    }
    const img = { width: w, height: h, data }

    const result = cookBakedScene({
      bundleId: 'b', sceneName: 'S',
      layers: [baseLayer({
        nodePath: '/W/V', nodeName: 'V',
        assetName: 'V', assetAlias: 'v-sheet', assetType: 'tile',
        cells: [{ x: 0, y: 0, z: 0 }],
        attributes: { export_role: 'terrain', template_id: 'v' },
      })],
      aliases: [{ alias: 'v-sheet', tileType: 'variant_test' }],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
      resolveRuleImage: () => img,
    })

    // Only slot 2 is visible → the single valid candidate → must be picked.
    expect(result.terrain.cells['0']![0]!.graphic_index).toEqual([2])
  })

  it('falls back to the raw variant range when no image is provided', () => {
    rulesDir = mkdtempSync(join(tmpdir(), 'scene-variant2-'))
    writeFileSync(join(rulesDir, 'variant_test2.json'), JSON.stringify({
      schemaVersion: 2,
      ppu: 16,
      sprites: [
        { x: 0, y: 0, w: 16, h: 16 },
        { x: 16, y: 0, w: 16, h: 16 },
      ],
      faces: {
        top: { basePieces: 1, variantIdxs: [1], randomRules: [{ tileId: 0, keepProbability: 0 }], map: { '*,*,*,*': 0 } },
      },
    }))
    setRulesDir(rulesDir)

    const result = cookBakedScene({
      bundleId: 'b', sceneName: 'S',
      layers: [baseLayer({
        nodePath: '/W/V', nodeName: 'V',
        assetName: 'V', assetAlias: 'v-sheet', assetType: 'tile',
        cells: [{ x: 0, y: 0, z: 0 }],
        attributes: { export_role: 'terrain', template_id: 'v' },
      })],
      aliases: [{ alias: 'v-sheet', tileType: 'variant_test2' }],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
      // no resolveRuleImage → candidate range [1] used as-is
    })
    expect(result.terrain.cells['0']![0]!.graphic_index).toEqual([1])
  })

  // ── common-16 regression: the iceberg's first symptom ──────────────────
  // A real common-16 tile-group: basePieces 16, interior key 1,1,1,1 → tile 6,
  // randomRules substitutes tile 6 from variantIdxs [16,17,18,19] (the bottom
  // row at y=64). In a real sheet only SOME bottom-row slots are drawn; the rest
  // are transparent placeholders. The renderer pixel-probes the sheet and samples
  // ONLY the non-transparent slots, so it never shows a transparent block. Before
  // the fix the export had its OWN headless probe (and returned ALL four when no
  // probe ran) → it could place a transparent variant the editor never shows.
  // After unification the cook calls the renderer's shared computeValidVariantIdxs
  // on the cook's decoded pixels → identical candidate set → identical seeded pick.
  it('common-16: export samples the randomized interior slot from the renderer\'s non-transparent variant set (never a transparent placeholder)', () => {
    rulesDir = mkdtempSync(join(tmpdir(), 'scene-common16-'))
    const sprites = [
      // 16 base pieces (4×4 grid, 16px each)
      ...Array.from({ length: 16 }, (_, i) => ({ x: (i % 4) * 16, y: Math.floor(i / 4) * 16, w: 16, h: 16 })),
      // 4 variant slots on row y=64 (idx 16..19)
      { x: 0, y: 64, w: 16, h: 16 },   // 16 transparent
      { x: 16, y: 64, w: 16, h: 16 },  // 17 transparent
      { x: 32, y: 64, w: 16, h: 16 },  // 18 OPAQUE (the only real variant)
      { x: 48, y: 64, w: 16, h: 16 },  // 19 transparent
    ]
    writeFileSync(join(rulesDir, 'common16_test.json'), JSON.stringify({
      schemaVersion: 2,
      ppu: 16,
      sprites,
      faces: {
        top: {
          basePieces: 16,
          map: { '1,1,1,1': 6, '*,*,*,*': 12 },
          // keepProbability 0 → ALWAYS substitute, so the chosen slot is fully
          // determined by the (filtered) candidate set + the cell's seeded RNG.
          randomRules: [{ tileId: 6, keepProbability: 0 }],
          variantIdxs: [16, 17, 18, 19],
        },
      },
    }))
    setRulesDir(rulesDir)

    // Sheet: everything transparent EXCEPT variant slot 18 (x=32..47, y=64..79).
    const w = 64, h = 80
    const data = new Uint8Array(w * h * 4)
    for (let y = 64; y < 80; y++) {
      for (let x = 32; x < 48; x++) {
        const i = (y * w + x) * 4
        data[i] = 0; data[i + 1] = 200; data[i + 2] = 0; data[i + 3] = 255
      }
    }
    const img = { width: w, height: h, data }

    // 3×3 filled block so the centre cell is a true interior (key 1,1,1,1 → tile 6).
    const cells: Array<{ x: number; y: number; z: number }> = []
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) cells.push({ x, y, z: 0 })

    const result = cookBakedScene({
      bundleId: 'b', sceneName: 'S',
      layers: [baseLayer({
        nodePath: '/W/C16', nodeName: 'C16',
        assetName: 'C16', assetAlias: 'c16-sheet', assetType: 'tile',
        cells, attributes: { export_role: 'terrain', template_id: 'c16' },
      })],
      aliases: [{ alias: 'c16-sheet', tileType: 'common16_test' }],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
      resolveRuleImage: () => img,
    })

    const rule = loadTileRule('common16_test')!
    const top = rule.faces.top! as unknown as FaceRule
    // The renderer's SHARED opacity filter over the cook's pixels: only slot 18.
    const validIdxs = computeValidVariantIdxs(top, rule.sprites, img)
    expect(validIdxs).toEqual([18])
    const transparentSlots = [16, 17, 19]

    const interior = { x: 1, y: 1, z: 0 }
    const coords = new Set(cells.map((c) => `${c.x},${c.y},${c.z}`))
    const emitted = result.terrain.cells['0']!
    const interiorGi = emitted.find((e) => e.x === interior.x && e.y === interior.y)!.graphic_index[0]

    // Export must pick FROM the renderer's non-transparent candidate set …
    expect(validIdxs).toContain(interiorGi)
    // … and NEVER a transparent placeholder slot.
    expect(transparentSlots).not.toContain(interiorGi)
    // … and it must equal the shared resolver's pick over that SAME set (one mechanism).
    const cc: CollectedCell = { x: interior.x, y: interior.y, z: interior.z, layerIdx: 0 }
    const resolverIdx = pickFaceSpriteIndex({
      face: top, faceTag: 'top', sprites: rule.sprites,
      validVariantIdxs: validIdxs, cell: cc,
      coordsByLayerIdx: new Map([[0, coords]]), regions: new Map(),
    })
    expect(interiorGi).toBe(resolverIdx)
  })

  it('randomRules: per-tileId variantIdxs pools are parsed and sampled independently', () => {
    rulesDir = mkdtempSync(join(tmpdir(), 'scene-per-tile-variant-'))
    writeFileSync(join(rulesDir, 'per_tile_variant.json'), JSON.stringify({
      schemaVersion: 2,
      ppu: 16,
      sprites: [
        { x: 0, y: 0, w: 16, h: 16 },
        { x: 16, y: 0, w: 16, h: 16 },
        { x: 32, y: 0, w: 16, h: 16 },
        { x: 48, y: 0, w: 16, h: 16 },
        { x: 0, y: 16, w: 16, h: 16 },
        { x: 16, y: 16, w: 16, h: 16 },
      ],
      faces: {
        top: {
          basePieces: 4,
          map: { '1,1,1,1': 1, '0,0,1,1': 2, '*,*,*,*': 0 },
          randomRules: [
            { tileId: 1, keepProbability: 0, variantIdxs: [4] },
            { tileId: 2, keepProbability: 0, variantIdxs: [5] },
          ],
          variantIdxs: [4, 5],
        },
      },
    }))
    setRulesDir(rulesDir)

    const rule = loadTileRule('per_tile_variant')!
    expect(rule.faces.top?.randomRules?.[0]?.variantIdxs).toEqual([4])
    expect(rule.faces.top?.randomRules?.[1]?.variantIdxs).toEqual([5])

    const img = { width: 64, height: 32, data: new Uint8Array(64 * 32 * 4).fill(255) }
    const byTileCook = computeValidTopVariantPoolsByTileId(rule, 'sheet-a', img)
    const byTileResolver = computeValidVariantPoolsByTileId(rule.faces.top! as unknown as FaceRule, rule.sprites, img)
    expect(byTileCook.get(1)?.idxs).toEqual([4])
    expect(byTileCook.get(2)?.idxs).toEqual([5])
    expect(byTileResolver.get(1)?.idxs).toEqual([4])
    expect(byTileResolver.get(2)?.idxs).toEqual([5])

    const blockCoords = new Set([
      '0,0,0', '1,0,0', '2,0,0',
      '0,1,0', '1,1,0', '2,1,0',
      '0,2,0', '1,2,0', '2,2,0',
    ])
    const stripCoords = new Set(['-1,0,0', '0,0,0', '1,0,0'])
    const top = rule.faces.top! as unknown as FaceRule
    const facePool = computeValidVariantIdxs(top, rule.sprites, img)
    expect(pickFaceSpriteIndex({
      face: top, faceTag: 'top', sprites: rule.sprites,
      validVariantIdxs: facePool,
      validVariantPoolsByTileId: byTileResolver,
      cell: { x: 1, y: 1, z: 0, layerIdx: 0 },
      coordsByLayerIdx: new Map([[0, blockCoords]]), regions: new Map(),
    })).toBe(4)
    expect(pickFaceSpriteIndex({
      face: top, faceTag: 'top', sprites: rule.sprites,
      validVariantIdxs: facePool,
      validVariantPoolsByTileId: byTileResolver,
      cell: { x: 0, y: 0, z: 0, layerIdx: 0 },
      coordsByLayerIdx: new Map([[0, stripCoords]]), regions: new Map(),
    })).toBe(5)
  })
})
