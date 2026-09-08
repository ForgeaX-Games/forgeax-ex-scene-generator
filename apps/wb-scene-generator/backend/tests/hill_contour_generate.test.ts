/**
 * hill_contour_generate / strip_cliff_generate 回归：
 *   - 输出严格贴合输入掩码，不外溢到掩码之外的空白
 *   - 山丘电池每层是实心嵌套面：层 i+1 ⊂ 层 i，隐藏上层必然露出下一层而不是地面
 *   - 层顶高度 0..N-1 与层网格一一对应（接 grid2node.z）
 *   - 条状悬崖电池是山丘电池的条带版存档：多值网格逐格一致，但各层互斥
 */
import { describe, it, expect } from 'vitest'

import { hillContourGenerate } from '../../batteries/components/elements/hill_contour_generate/index.js'
import { stripCliffGenerate } from '../../batteries/components/elements/strip_cliff_generate/index.js'

type Grid = number[][]

const ROWS = 60
const COLS = 60

/** 偏在左上角、带一处凹口的有机岛——用来暴露「按整张网格归一化」和「后处理外溢」两类 bug。 */
function concaveIsland(): { mask: Grid; area: number } {
  const mask: Grid = Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(0))
  let area = 0
  for (let r = 4; r < 34; r++)
    for (let c = 4; c < 34; c++)
      if (Math.hypot(r - 19, c - 19) < 14 && !(r > 24 && c > 24)) { mask[r][c] = 1; area++ }
  return { mask, area }
}

function cellCount(grid: Grid): number {
  return grid.flat().filter((v) => v !== 0).length
}

type HillOut = {
  outputGrids: Grid[]
  outputLevels: number[]
  outputGrid: Grid
  outputNameList: { id: number; name: string; type: string }[]
}

function runHill(over: Record<string, unknown> = {}): HillOut {
  const { mask } = concaveIsland()
  const out = hillContourGenerate({
    inputGrid: mask, contourLevels: 6, hillCount: 1, seed: 7, peakPosition: 5, ...over,
  })
  expect(out.error).toBeUndefined()
  return out as unknown as HillOut
}

describe('hill_contour_generate', () => {
  it('最低层实心面恰好等于输入掩码，不外溢也不缺格', () => {
    const { mask, area } = concaveIsland()
    const { outputGrids } = runHill()
    const base = outputGrids[0]
    expect(cellCount(base)).toBe(area)
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        expect(base[r][c] !== 0).toBe(mask[r][c] !== 0)
  })

  it('多值网格的覆盖范围也严格落在掩码内（后处理不越界）', () => {
    const { mask, area } = concaveIsland()
    const { outputGrid } = runHill()
    expect(cellCount(outputGrid)).toBe(area)
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        if (!mask[r][c]) expect(outputGrid[r][c]).toBe(0)
  })

  it('每层是实心嵌套面：上层 ⊂ 下层，面积逐层递减，格值 = 层号', () => {
    const { outputGrids } = runHill()
    expect(outputGrids).toHaveLength(6)

    for (let i = 1; i < outputGrids.length; i++) {
      expect(cellCount(outputGrids[i])).toBeLessThan(cellCount(outputGrids[i - 1]))
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          if (outputGrids[i][r][c] !== 0) expect(outputGrids[i - 1][r][c]).not.toBe(0)
    }
    outputGrids.forEach((g, i) => g.flat().forEach((v) => { if (v !== 0) expect(v).toBe(i + 1) }))
  })

  it('隐藏任意上层都露出下一层的顶面，不会露到地面', () => {
    const { outputGrids } = runHill()
    for (let i = outputGrids.length - 1; i > 0; i--) {
      let uncovered = 0
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          if (outputGrids[i][r][c] !== 0 && outputGrids[i - 1][r][c] === 0) uncovered++
      expect(uncovered).toBe(0)
    }
  })

  it('层顶高度从 0 起逐层 +1，与层网格和名称清单一一对应', () => {
    const { outputGrids, outputLevels, outputNameList } = runHill()
    expect(outputLevels).toEqual([0, 1, 2, 3, 4, 5])
    expect(outputLevels).toHaveLength(outputGrids.length)
    expect(outputNameList.map((n) => n.id)).toEqual([1, 2, 3, 4, 5, 6])
    expect(outputNameList.every((n) => n.type === 'tile')).toBe(true)
  })

  it('ContourLevels 决定层数；空掩码不产出任何层', () => {
    expect(runHill({ contourLevels: 4 }).outputGrids).toHaveLength(4)
    expect(runHill({ contourLevels: 8 }).outputGrids).toHaveLength(8)

    const empty = hillContourGenerate({ inputGrid: [[0, 0], [0, 0]] }) as unknown as HillOut
    expect(empty.outputGrids).toEqual([])
    expect(empty.outputLevels).toEqual([])
  })
})

describe('strip_cliff_generate（条带版存档）', () => {
  it('与山丘电池同参下的多值网格逐格一致', () => {
    const { mask } = concaveIsland()
    const args = { inputGrid: mask, contourLevels: 6, hillCount: 1, seed: 7, peakPosition: 5 }
    const strip = stripCliffGenerate(args) as { outputGrid: Grid }
    const hill = hillContourGenerate(args) as unknown as HillOut
    expect(strip.outputGrid).toEqual(hill.outputGrid)
  })

  it('各层互斥：条带面积之和 = 掩码面积（与山丘电池的实心面不同）', () => {
    const { mask, area } = concaveIsland()
    const strip = stripCliffGenerate({
      inputGrid: mask, contourLevels: 6, hillCount: 1, seed: 7, peakPosition: 5,
    }) as { outputGrid: Grid }

    const bands = [1, 2, 3, 4, 5, 6].map((lv) => strip.outputGrid.flat().filter((v) => v === lv).length)
    expect(bands.reduce((a, b) => a + b, 0)).toBe(area)
    // 等面积重映射：各条带格子数相近
    expect(Math.max(...bands) - Math.min(...bands)).toBeLessThanOrEqual(2)
  })
})
