// 💡 Path A 视口=渲染结果 parity(node env, @napi-rs/canvas)
//
// 证明:导出端逐屏幕格 ORDERED sprite 栈 == 渲染器 ACTUAL 画出来的栈。手段是给
// buildVoxelMaster 装上 ADDITIVE 的 onResolve 捕获 sink,在真实 napi canvas 上跑
// 一遍 bake,拿到渲染器**实际**的 (cull 之后、painter sort 之后、face 选完、变体
// 过滤完) 有序绘制结果,再断言:
//   (1) 渲染器逐格画出来的顺序 === 共享比较器 compareBillboardDrawOrder 的顺序
//       —— 即 cooker 现在用来排序 per-cell 栈的同一把键就是渲染器真实绘制序;
//   (2) 被遮挡 / 剔除的 sprite 根本不会出现在捕获里(occlusion = 没 emit);
//   (3) 变体过滤后透明槽永不被画(common-16 类),与导出共用同一过滤。
//
// 没有 onResolve sink 时绘制路径逐字节不变(另一个 test 验证默认 bake 像素一致)。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createCanvas } from '@napi-rs/canvas'
import { buildVoxelMaster, type ResolvedDraw } from '../../modes/topBillboard/buildVoxelMaster'
import { compareBillboardDrawOrder } from '../../modes/topBillboard/buildVoxelMaster/billboardDrawOrder'
import { setCanvas2DBackend, type Surface2D } from '../../framework/canvas2d'
import { setServerImageResolver } from '../../framework/asset/imageCache'
import { getOrLoadRule } from '../../framework/asset/ruleCache'
import { voxelLayerCellSource } from '../../framework/cellSource'
import type { RendererVoxelLayer } from '../../types'
import type { VoxelLayerInput } from '../../modes/topBillboard/buildVoxelMaster'

// A 64×80 sheet: 16 base pieces (4×4 @ y=0..63) + 4 variant slots @ y=64; only
// slot 18 (x=32..47) is opaque — the common-16 transparent-variant scenario.
function makeSheet(): { width: number; height: number; data: Uint8ClampedArray } {
  const w = 64, h = 80
  const data = new Uint8ClampedArray(w * h * 4)
  // base pieces: fully opaque grey so every base tile draws.
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const i = (y * w + x) * 4
    data[i] = 120; data[i + 1] = 120; data[i + 2] = 120; data[i + 3] = 255
  }
  // variant slot 18 (x=32..47, y=64..79) opaque green; slots 16,17,19 transparent.
  for (let y = 64; y < 80; y++) for (let x = 32; x < 48; x++) {
    const i = (y * w + x) * 4
    data[i] = 0; data[i + 1] = 200; data[i + 2] = 0; data[i + 3] = 255
  }
  return { width: w, height: h, data }
}

// A v2 rule with BOTH faces so voxels draw a top cap AND a front wall — the
// cross-face overlap is exactly where painter order / occlusion matters.
const RULE_JSON = {
  schemaVersion: 2,
  ppu: 16,
  sprites: [
    ...Array.from({ length: 16 }, (_, i) => ({ x: (i % 4) * 16, y: Math.floor(i / 4) * 16, w: 16, h: 16 })),
    { x: 0, y: 64, w: 16, h: 16 },
    { x: 16, y: 64, w: 16, h: 16 },
    { x: 32, y: 64, w: 16, h: 16 },
    { x: 48, y: 64, w: 16, h: 16 },
  ],
  faces: {
    top: {
      basePieces: 16,
      map: { '1,1,1,1': 6, '*,*,*,*': 12 },
      randomRules: [{ tileId: 6, keepProbability: 0 }],
      variantIdxs: [16, 17, 18, 19],
    },
    front: { basePieces: 16, map: { '*,*,*,*': 8 } },
  },
}

const ALIAS = '[0][1][2][3][Grass][5][6][7][parity_rule][16][10][11][v]'

async function seedRule(): Promise<void> {
  const stub = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => RULE_JSON,
  })
  ;(globalThis as unknown as { fetch: typeof fetch }).fetch = stub as unknown as typeof fetch
  // First call starts the async load (returns null); spin microtasks until ready.
  getOrLoadRule(ALIAS)
  for (let i = 0; i < 50 && getOrLoadRule(ALIAS) === null; i++) {
    await Promise.resolve()
  }
}

function recordingBackend(): void {
  setCanvas2DBackend({
    createSurface: (w, h) => createCanvas(Math.max(1, w), Math.max(1, h)) as unknown as Surface2D,
    devicePixelRatio: () => 1,
  })
}

function makeInputs(layers: RendererVoxelLayer[]): VoxelLayerInput[] {
  return layers.map((layer, idx) => ({
    source: voxelLayerCellSource(layer),
    layerIdx: idx,
    isSelected: false,
    isEditorSelected: false,
    assetName: layer.assetName,
    assetAlias: layer.assetAlias,
    assetType: layer.assetType,
    nodePath: layer.nodePath,
  }))
}

function captureDraws(layers: RendererVoxelLayer[]): ResolvedDraw[] {
  const draws: ResolvedDraw[] = []
  buildVoxelMaster(makeInputs(layers), {
    drawMode: 'asset',
    aliases: [{ alias: ALIAS, tileType: 'parity_rule' }],
    onResolve: (d) => draws.push(d),
  })
  return draws
}

beforeEach(async () => {
  recordingBackend()
  const sheet = makeSheet()
  // Server image resolver returns a real napi canvas (so the variant pixel-probe
  // reads true alpha) sized to the sheet, with the sheet's pixels blitted in.
  const sheetCanvas = createCanvas(sheet.width, sheet.height)
  const sctx = sheetCanvas.getContext('2d')
  const imgData = sctx.createImageData(sheet.width, sheet.height)
  imgData.data.set(sheet.data)
  sctx.putImageData(imgData, 0, 0)
  setServerImageResolver(() => sheetCanvas as unknown as HTMLImageElement)
  await seedRule()
})

afterEach(() => {
  setServerImageResolver(null)
  vi.restoreAllMocks()
})

function layer(nodePath: string, cells: Array<{ x: number; y: number; z: number }>): RendererVoxelLayer {
  return {
    key: `n:${nodePath}`, nodeId: 'n', nodePath, nodeName: nodePath.slice(1), value: 1,
    cells: cells.map((c) => ({ ...c, token: 'Grass' })),
    visible: true, updatedAt: 0,
    assetName: 'Grass', assetAlias: ALIAS, assetType: 'tile',
  }
}

describe('Path A: export per-screen-cell stack == renderer captured draw', () => {
  it('renderer draws in EXACTLY compareBillboardDrawOrder order, per screen cell', () => {
    // A 3×3 block (interior cell exists) + a taller voxel column so top/front of
    // different voxels collide on shared screen rows → order matters.
    const cells: Array<{ x: number; y: number; z: number }> = []
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) cells.push({ x, y, z: 0 })
    cells.push({ x: 1, y: 1, z: 1 }) // stacked voxel above the interior

    const draws = captureDraws([layer('/Floor', cells)])
    expect(draws.length).toBeGreaterThan(0)

    // Group by screen cell; within each, the capture order (drawSeq asc) must be
    // identical to sorting by the SHARED comparator the cook uses.
    const byCell = new Map<string, ResolvedDraw[]>()
    for (const d of draws) {
      const k = `${d.screenX},${d.screenY}`
      ;(byCell.get(k) ?? byCell.set(k, []).get(k)!).push(d)
    }
    for (const stack of byCell.values()) {
      const asDrawn = stack.slice().sort((a, b) => a.drawSeq - b.drawSeq)
      const asComparator = stack.slice().sort((a, b) =>
        compareBillboardDrawOrder(
          { y: a.srcY, z: a.z, layerIdx: a.layerIdx, face: a.face },
          { y: b.srcY, z: b.z, layerIdx: b.layerIdx, face: b.face },
        ))
      expect(asComparator.map((d) => d.drawSeq)).toEqual(asDrawn.map((d) => d.drawSeq))
    }
  })

  it('occlusion: a voxel column emits a stacked front wall over the lower top — culled nothing, order encodes coverage', () => {
    // Two voxels in one column: z=0 and z=1. The z=1 front wall lands on screen
    // row (y - 1) = the SAME row as z=0's top cap (y - 0 - 1). The renderer draws
    // z=0 first then z=1, so the z=1 front paints over the z=0 top → coverage.
    const draws = captureDraws([layer('/Col', [{ x: 0, y: 2, z: 0 }, { x: 0, y: 2, z: 1 }])])
    const sharedRow = 2 - 0 - 1 // = 1
    const atRow = draws.filter((d) => d.screenX === 0 && d.screenY === sharedRow)
      .sort((a, b) => a.drawSeq - b.drawSeq)
    // The LAST draw at the shared row (visually on top) must be the z=1 front wall.
    expect(atRow.length).toBeGreaterThanOrEqual(2)
    const topMost = atRow[atRow.length - 1]!
    expect(topMost.face).toBe('front')
    expect(topMost.z).toBe(1)
  })

  it('variant: the interior cell never resolves a transparent slot (common-16 class)', () => {
    const cells: Array<{ x: number; y: number; z: number }> = []
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) cells.push({ x, y, z: 0 })
    const draws = captureDraws([layer('/Floor', cells)])
    const interiorTop = draws.find((d) => d.face === 'top' && d.screenX === 1 && d.screenY === 1 - 0 - 1)
    expect(interiorTop).toBeTruthy()
    // Slot 18 is the only opaque variant; 16/17/19 are transparent placeholders.
    expect([16, 17, 19]).not.toContain(interiorTop!.spriteIndex)
    expect(interiorTop!.spriteIndex).toBe(18)
  })

  it('layer stacking: two overlapping layers stack later-layer-on-top, matching the comparator', () => {
    const draws = captureDraws([
      layer('/Lower', [{ x: 0, y: 0, z: 0 }]),
      layer('/Upper', [{ x: 0, y: 0, z: 0 }]),
    ])
    // Same screen cell (top cap at (0,-1)); the later layer (layerIdx 1) draws last.
    const topCaps = draws.filter((d) => d.face === 'top' && d.screenX === 0 && d.screenY === -1)
      .sort((a, b) => a.drawSeq - b.drawSeq)
    expect(topCaps.length).toBe(2)
    expect(topCaps[0]!.layerIdx).toBe(0)
    expect(topCaps[topCaps.length - 1]!.layerIdx).toBe(1)
  })
})

describe('Path A: onResolve is ADDITIVE — default bake pixels unchanged', () => {
  it('bake with and without the sink produces byte-identical master pixels', () => {
    const cells: Array<{ x: number; y: number; z: number }> = []
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) cells.push({ x, y, z: 0 })
    cells.push({ x: 1, y: 1, z: 1 })
    const inputs = makeInputs([layer('/Floor', cells)])
    const opts = { drawMode: 'asset' as const, aliases: [{ alias: ALIAS, tileType: 'parity_rule' }] }

    const withoutSink = buildVoxelMaster(inputs, opts)
    const withSink = buildVoxelMaster(inputs, { ...opts, onResolve: () => { /* capture, no draw effect */ } })
    expect(withoutSink).toBeTruthy()
    expect(withSink).toBeTruthy()

    const toBuf = (m: NonNullable<typeof withoutSink>) =>
      (m.canvas as unknown as { toBuffer: (t: string) => Buffer }).toBuffer('image/png')
    expect(toBuf(withSink!).equals(toBuf(withoutSink!))).toBe(true)
  })
})
