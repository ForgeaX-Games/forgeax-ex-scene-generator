// 💡 rail_28 端头/带弯链路的端到端断言（真规则 + 真电池 + 真 resolver）
//
// 铁轨是恒 2 格宽带，三类歧义决定了 rule 的三段分工，本测试逐条钉住：
//   ① 内角只能靠对角 → faces.top(adjacent8)
//   ② 「带弯」过渡片与直边八邻域同形 → faces.entry(edgeDist4)，靠「靠角侧 dist-1 空
//      + 垂直方向 dist-2 实」区分「旁边是拐角」与「旁边只是端头」
//   ③ 端头（20-27）与外角连 edgeDist4 都可能同形 → 只能上游打标：
//      bridge_entry_tag(thickness=2) → grid2node(stateGrid/stateKey='railTag')
//      → projectSceneToVoxelLayers(state) → faces.entry.variants[].when.stateEquals
// 走 vendor/dist/renderer-resolve —— 导出与浏览器渲染共用的那一份 resolver。

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
const rule = JSON.parse(readFileSync(join(APP_ROOT, 'assets', 'rules', 'rail_28.json'), 'utf8')) as {
  sprites: Array<{ x: number; y: number; w: number; h: number }>
  faces: { top: FaceRule; entry: FaceRule }
}

// 示意图的版位：基块 5×5 环 + 右侧两组收边块；每基块 4 个变体，tile t → sprites[28+4t..31+4t]
// （t 0-19 在第 5+t 行 cols0-3，t 20-27 在第 2+(t-20) 行 cols5-8）。
const BASE_CELLS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [1, 0], [2, 0], [3, 0], [4, 0],
  [0, 1], [1, 1], [3, 1], [4, 1],
  [0, 2], [4, 2],
  [0, 3], [1, 3], [3, 3], [4, 3],
  [0, 4], [1, 4], [2, 4], [3, 4], [4, 4],
  [5, 0], [6, 0], [5, 1], [6, 1],
  [7, 0], [8, 0], [7, 1], [8, 1],
]
const variantCells = (t: number): Array<[number, number]> =>
  t < 20
    ? [0, 1, 2, 3].map((c) => [c, 5 + t] as [number, number])
    : [5, 6, 7, 8].map((c) => [c, 2 + (t - 20)] as [number, number])

type Cells = Map<string, Record<string, unknown> | undefined>

/** 走渲染器真实取片顺序：entry 命中优先，否则回落 top。返回 sprite 下标 = 基块 id。 */
function resolve(cells: Cells, x: number, y: number): number {
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

/** 掩码 → 打标 → grid2node → projection，得到 "x,y,z" → state 表（渲染器的真实输入）。 */
function project(grid: number[][]): Cells {
  const tagged = bridgeEntryTag({ inputGrid: grid, thickness: 2 }) as {
    tagGrid: number[][]
    stateValues: string[]
  }
  const node = grid2Node({
    name: 'Rail',
    grid,
    stateGrid: tagged.tagGrid,
    stateKey: 'railTag',
    stateValues: tagged.stateValues,
  }) as { scene?: { graph: unknown; focus: unknown } }
  const scene = node.scene!
  const bundle = projectSceneToVoxelLayers(scene.graph as never, scene.focus as never)
  const out: Cells = new Map()
  for (const layer of bundle.layers) {
    for (const c of layer.cells) out.set(`${c.x},${c.y},${c.z}`, c.state as Record<string, unknown> | undefined)
  }
  return out
}

function blank(w: number, h: number): number[][] {
  return Array.from({ length: h }, () => new Array<number>(w).fill(0))
}
function fill(g: number[][], x0: number, y0: number, x1: number, y1: number, v = 1): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = v
}

// 2 格厚的最小闭合环（6×6、中心 2×2 空洞）——示意图那 20 个环块的完整用例集：
// 四个「四件套」各占一个 2×2 角，四条边各有直边与带弯。
function ringGrid(): number[][] {
  const g = blank(6, 6)
  fill(g, 0, 0, 5, 5)
  fill(g, 2, 2, 3, 3, 0)
  return g
}

describe('rail_28：切片与变体版位对齐示意图', () => {
  it('28 基块坐标 = 5×5 环 + 右侧收边块；图集 144×400', () => {
    expect(rule.sprites.length).toBe(28 + 28 * 4)
    BASE_CELLS.forEach(([col, row], t) => {
      expect([rule.sprites[t].x, rule.sprites[t].y, rule.sprites[t].w, rule.sprites[t].h])
        .toEqual([col * 16, row * 16, 16, 16])
    })
    const bounds = rule.sprites.reduce(
      (a, s) => ({ w: Math.max(a.w, s.x + s.w), h: Math.max(a.h, s.y + s.h) }), { w: 0, h: 0 })
    expect(bounds).toEqual({ w: 144, h: 400 })
  })

  it('每个基块都挂着 4 个变体，且变体 sprite 落在示意图给它的那一行', () => {
    const faces = [rule.faces.top, rule.faces.entry] as Array<FaceRule & {
      randomRules?: Array<{ tileId: number; variantIdxs?: number[] }>
    }>
    const byTile = new Map<number, number[]>()
    for (const f of faces) {
      for (const r of f.randomRules ?? []) {
        expect(byTile.has(r.tileId)).toBe(false) // 同一基块不能在两个面上各挂一次
        byTile.set(r.tileId, r.variantIdxs ?? [])
      }
    }
    expect([...byTile.keys()].sort((a, b) => a - b)).toEqual([...Array(28).keys()])
    for (const [t, idxs] of byTile) {
      expect(idxs).toEqual([0, 1, 2, 3].map((k) => 28 + 4 * t + k))
      expect(idxs.map((i) => [rule.sprites[i].x / 16, rule.sprites[i].y / 16]))
        .toEqual(variantCells(t))
    }
  })
})

describe('rail_28：环上 20 块各就各位', () => {
  it('外角/带弯/内角/直边逐格对位，且整环无一格需要打标', () => {
    const grid = ringGrid()
    const { tagGrid } = bridgeEntryTag({ inputGrid: grid, thickness: 2 }) as { tagGrid: number[][] }
    expect(tagGrid.flat().every((v) => v === 0)).toBe(true)

    const cells = project(grid)
    const at = (x: number, y: number): number => resolve(cells, x, y)
    const row = (y: number, xs: number[]): number[] => xs.map((x) => at(x, y))

    expect(row(0, [0, 1, 2, 3, 4, 5])).toEqual([0, 1, 2, 2, 3, 4])
    expect(row(1, [0, 1, 2, 3, 4, 5])).toEqual([5, 6, 17, 17, 7, 8])
    expect(row(2, [0, 1, 4, 5])).toEqual([9, 10, 9, 10])
    expect(row(3, [0, 1, 4, 5])).toEqual([9, 10, 9, 10])
    expect(row(4, [0, 1, 2, 3, 4, 5])).toEqual([11, 12, 2, 2, 13, 14])
    expect(row(5, [0, 1, 2, 3, 4, 5])).toEqual([15, 16, 17, 17, 18, 19])
  })
})

describe('rail_28：端头由 railTag 驱动', () => {
  // 竖向轨 cols0-1 × rows0-5（孤立），上下两端应收边而不是画成外角。
  it('竖向轨上下端头 → 20/21、22/23；轨身 → 9/10', () => {
    const g = blank(2, 6)
    fill(g, 0, 0, 1, 5)
    const cells = project(g)
    expect(cells.get('0,0,0')).toEqual({ railTag: 'entry_h' })
    expect(cells.get('0,2,0')).toBeUndefined()

    const at = (x: number, y: number): number => resolve(cells, x, y)
    expect([at(0, 0), at(1, 0)]).toEqual([20, 21])
    expect([at(0, 5), at(1, 5)]).toEqual([22, 23])
    for (let y = 1; y <= 4; y++) expect([at(0, y), at(1, y)]).toEqual([9, 10])
  })

  // 横向轨 rows0-1 × cols0-5（孤立），左右两端应收边。
  it('横向轨左右端头 → 24/26、25/27；轨身 → 2/17', () => {
    const g = blank(6, 2)
    fill(g, 0, 0, 5, 1)
    const cells = project(g)
    expect(cells.get('0,0,0')).toEqual({ railTag: 'entry_v' })

    const at = (x: number, y: number): number => resolve(cells, x, y)
    expect([at(0, 0), at(0, 1)]).toEqual([24, 26])
    expect([at(5, 0), at(5, 1)]).toEqual([25, 27])
    for (let x = 1; x <= 4; x++) expect([at(x, 0), at(x, 1)]).toEqual([2, 17])
  })

  it('去掉标签后端头退化成外角（证明这一分派只能靠上游打标）', () => {
    const g = blank(2, 6)
    fill(g, 0, 0, 1, 5)
    const cells = project(g)
    const untagged: Cells = new Map([...cells.keys()].map((k) => [k, undefined]))
    expect([resolve(untagged, 0, 0), resolve(untagged, 1, 0)]).toEqual([0, 4])
  })
})

describe('rail_28：L 拐角与「带弯 vs 端头旁的直边」', () => {
  // 竖臂 cols0-1 × rows0-7，在底部右转成横臂 rows6-7 × cols0-9。
  function lGrid(): number[][] {
    const g = blank(10, 8)
    fill(g, 0, 0, 1, 7)
    fill(g, 0, 6, 9, 7)
    return g
  }

  it('拐角四件套 = 11/12/15/16，拐角本身不被误判为端头', () => {
    const grid = lGrid()
    const { tagGrid } = bridgeEntryTag({ inputGrid: grid, thickness: 2 }) as { tagGrid: number[][] }
    expect(tagGrid[7][0]).toBe(0)
    expect(tagGrid[6][0]).toBe(0)

    const cells = project(grid)
    const at = (x: number, y: number): number => resolve(cells, x, y)
    expect([at(0, 6), at(1, 6)]).toEqual([11, 12])
    expect([at(0, 7), at(1, 7)]).toEqual([15, 16])
  })

  it('端头旁的直边不画带弯（d2/u2/l2/r2 那一位就是分界）', () => {
    const cells = project(lGrid())
    const at = (x: number, y: number): number => resolve(cells, x, y)
    // 竖臂顶端下面一格：上面是端头而非拐角 → 竖直边 9/10，不是带弯 5/8
    expect([at(0, 1), at(1, 1)]).toEqual([9, 10])
    // 横臂右端左边一格：右边是端头而非拐角 → 横直边 2/17，不是带弯 3/18
    expect([at(8, 6), at(8, 7)]).toEqual([2, 17])
    // 两端仍然各自收边
    expect([at(0, 0), at(1, 0)]).toEqual([20, 21])
    expect([at(9, 6), at(9, 7)]).toEqual([25, 27])
  })
})
