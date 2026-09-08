// 💡 bridge_25 端头标签链路的端到端断言（真规则 + 真电池 + 真 resolver）
//
// 桥梁 autotile 的端头收口块与桥身扶手块**八邻域完全同形**（竖向桥上端头中格与
// 横向桥顶部扶手中格都是 0,1,1,1,0,0,1,1），所以 faces.entry 不能靠邻域自己判断，
// 必须由上游 bridge_entry_tag 按格打 `state.bridgeTag`，rule 用 when.stateEquals
// 分派 map。本测试跑通整条链：
//   bridge_entry_tag(掩码) → grid2node(stateGrid) → projectSceneToVoxelLayers(state)
//   → 渲染器 pickFaceSpriteIndexIfMapped(entry) / pickFaceSpriteIndex(top)
// 用的是 vendor/dist/renderer-resolve —— 导出与浏览器渲染共用的那一份 resolver。

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  pickFaceSpriteIndex,
  pickFaceSpriteIndexIfMapped,
  type CollectedCell,
  type FaceRule,
} from '../../vendor/dist/renderer-resolve/renderer/server/spriteResolver.js'
import { projectSceneToVoxelLayers } from '../../vendor/dist/shared/types/index.js'
import { bridgeEntryTag } from '../../batteries/components/Topographic/bridge_entry_tag/index.ts'
import { grid2Node } from '../../batteries/scene/bridge/grid2node/index.ts'

const APP_ROOT = join(import.meta.dirname, '..', '..')
const rule = JSON.parse(readFileSync(join(APP_ROOT, 'assets', 'rules', 'bridge_25.json'), 'utf8')) as {
  sprites: Array<{ x: number; y: number; w: number; h: number }>
  faces: { top: FaceRule; entry: FaceRule }
}

// 十字桥：竖臂 x∈[6,8] 贯穿 y∈[0,11]，横臂 y∈[4,6] 贯穿 x∈[0,14]。
const W = 15
const H = 12
function crossGrid(): number[][] {
  const g = Array.from({ length: H }, () => new Array<number>(W).fill(0))
  for (let y = 0; y < H; y++) for (let x = 6; x <= 8; x++) g[y][x] = 1
  for (let y = 4; y <= 6; y++) for (let x = 0; x < W; x++) g[y][x] = 1
  return g
}

/** 走渲染器真实取片顺序：entry 命中优先，否则回落 top。返回 sprite 下标 = 基块 id。 */
function resolve(
  cells: Map<string, Record<string, unknown> | undefined>,
  x: number,
  y: number,
): number {
  const coords = new Set([...cells.keys()])
  const state = cells.get(`${x},${y},0`)
  const cell: CollectedCell = { x, y, z: 0, layerIdx: 0, ...(state ? { state } : {}) }
  const ctx = {
    sprites: rule.sprites,
    validVariantIdxs: [] as number[],
    cell,
    coordsByLayerIdx: new Map([[0, coords]]),
    regions: new Map<string, Set<string>>(),
  }
  const entryIdx = pickFaceSpriteIndexIfMapped({ ...ctx, face: rule.faces.entry, faceTag: 'entry' })
  if (entryIdx !== null) return entryIdx
  return pickFaceSpriteIndex({ ...ctx, face: rule.faces.top, faceTag: 'top' })
}

/** 把十字桥跑完 tag → grid2node → projection，得到 "x,y,z" → state 的表。 */
function projectCross(): Map<string, Record<string, unknown> | undefined> {
  const grid = crossGrid()
  const tagged = bridgeEntryTag({ inputGrid: grid, thickness: 3 }) as {
    tagGrid: number[][]
    stateValues: string[]
    entryCount: number
  }
  const node = grid2Node({
    name: 'Bridge',
    grid,
    stateGrid: tagged.tagGrid,
    stateKey: 'bridgeTag',
    stateValues: tagged.stateValues,
  }) as { scene?: { graph: unknown; focus: unknown } }
  const scene = node.scene!
  const bundle = projectSceneToVoxelLayers(scene.graph as never, scene.focus as never)
  const out = new Map<string, Record<string, unknown> | undefined>()
  for (const layer of bundle.layers) {
    for (const c of layer.cells) out.set(`${c.x},${c.y},${c.z}`, c.state as Record<string, unknown> | undefined)
  }
  return out
}

describe('bridge_entry_tag', () => {
  it('只把「厚度 ≤ thickness 的终止长条」标为端头，桥身与扶手不标', () => {
    const { tagGrid } = bridgeEntryTag({ inputGrid: crossGrid(), thickness: 3 }) as { tagGrid: number[][] }
    // 竖臂上下端头 → 横长条(1)
    expect([tagGrid[0][6], tagGrid[0][7], tagGrid[0][8]]).toEqual([1, 1, 1])
    expect([tagGrid[11][6], tagGrid[11][7], tagGrid[11][8]]).toEqual([1, 1, 1])
    // 横臂左右端头 → 竖长条(2)
    expect([tagGrid[4][0], tagGrid[5][0], tagGrid[6][0]]).toEqual([2, 2, 2])
    expect([tagGrid[4][14], tagGrid[5][14], tagGrid[6][14]]).toEqual([2, 2, 2])
    // 竖臂扶手 / 横臂扶手 / 交叉区 一律不标
    expect(tagGrid[1][6]).toBe(0)
    expect(tagGrid[4][3]).toBe(0)
    expect(tagGrid[5][7]).toBe(0)
  })

  it('L 拐角外侧那一列不会被误判为端头（长度 = 桥臂长而非桥宽）', () => {
    // 竖臂 x∈[0,2] y∈[0,10]，在底部右转成横臂 y∈[8,10] x∈[0,20]
    const g = Array.from({ length: 11 }, () => new Array<number>(21).fill(0))
    for (let y = 0; y <= 10; y++) for (let x = 0; x <= 2; x++) g[y][x] = 1
    for (let y = 8; y <= 10; y++) for (let x = 0; x <= 20; x++) g[y][x] = 1
    const { tagGrid } = bridgeEntryTag({ inputGrid: g, thickness: 3 }) as { tagGrid: number[][] }
    expect(tagGrid[10][0]).toBe(0) // 拐角外侧
    expect(tagGrid[9][0]).toBe(0)
    expect([tagGrid[0][0], tagGrid[0][1], tagGrid[0][2]]).toEqual([1, 1, 1]) // 竖臂上端头
    expect([tagGrid[8][20], tagGrid[9][20], tagGrid[10][20]]).toEqual([2, 2, 2]) // 横臂右端头
  })
})

describe('grid2node → projection 的逐格标签通道', () => {
  it('stateGrid 经 stateValues 映射后落到体素 state，并被 projection 透传', () => {
    const cells = projectCross()
    expect(cells.get('6,0,0')).toEqual({ bridgeTag: 'entry_h' })
    expect(cells.get('0,4,0')).toEqual({ bridgeTag: 'entry_v' })
    expect(cells.get('6,1,0')).toBeUndefined() // 桥身不带标签
  })

  it('未接 stateGrid 时体素不带 state（保持旧行为）', () => {
    const node = grid2Node({ name: 'Plain', grid: [[1, 1], [1, 1]] }) as { scene?: { graph: unknown; focus: unknown } }
    const bundle = projectSceneToVoxelLayers(node.scene!.graph as never, node.scene!.focus as never)
    expect(bundle.layers[0].cells.every((c) => c.state === undefined)).toBe(true)
  })
})

describe('bridge_25 取片', () => {
  it('端头走 entry 面的标签分派，桥身/扶手/角点走 top 面', () => {
    const cells = projectCross()
    const at = (x: number, y: number): number => resolve(cells, x, y)

    // 竖向桥上端头行（横长条）→ 0/1/2；下端头行 → 5/6/7
    expect([at(6, 0), at(7, 0), at(8, 0)]).toEqual([0, 1, 2])
    expect([at(6, 11), at(7, 11), at(8, 11)]).toEqual([5, 6, 7])
    // 横向桥左端头列（竖长条）→ 8/11/14；右端头列 → 10/13/16
    expect([at(0, 4), at(0, 5), at(0, 6)]).toEqual([8, 11, 14])
    expect([at(14, 4), at(14, 5), at(14, 6)]).toEqual([10, 13, 16])
    // 竖向桥左右扶手 3/4，中段 12
    expect([at(6, 1), at(7, 1), at(8, 1)]).toEqual([3, 12, 4])
    // 横向桥上下扶手 9/15，中段 12
    expect([at(3, 4), at(3, 5), at(3, 6)]).toEqual([9, 12, 15])
    // 交叉处四个内凹角 → L 角柱
    expect([at(6, 4), at(8, 4), at(6, 6), at(8, 6)]).toEqual([21, 23, 18, 20])
  })

  it('无标签的格子在 entry 面上不命中（保证 entry 只由标签驱动）', () => {
    const cells = projectCross()
    const coords = new Set([...cells.keys()])
    const ctx = {
      sprites: rule.sprites,
      validVariantIdxs: [] as number[],
      coordsByLayerIdx: new Map([[0, coords]]),
      regions: new Map<string, Set<string>>(),
      face: rule.faces.entry,
      faceTag: 'entry' as const,
    }
    // 竖向桥左扶手：与横向桥左端头中格 (1,1,0,1,…) 同键，旧版被 entry 抢走成 11
    expect(pickFaceSpriteIndexIfMapped({ ...ctx, cell: { x: 6, y: 1, z: 0, layerIdx: 0 } })).toBeNull()
    // 横向桥顶部扶手：与竖向桥上端头中格 (0,1,1,1,…) 同键，旧版被 entry 抢走成 1
    expect(pickFaceSpriteIndexIfMapped({ ...ctx, cell: { x: 3, y: 4, z: 0, layerIdx: 0 } })).toBeNull()
  })
})
