/**
 * polyline_road_spline 回归：
 *   - 曲线严格穿过每一个控制点（含回折路线，不按 x 重排）
 *   - 道路 8-连通不断线，且只输出道路本身（其余为 0）
 *   - clipToFootprint 裁剪到上游足迹
 *   - 确定性：同输入同输出；points 不足 2 个不重复点时报错
 */
import { describe, it, expect } from 'vitest'

import { polylineRoadSpline } from '../../batteries/scene40/Agents/polyline_road_spline/index.js'

type Grid = number[][]

function openGround(rows = 40, cols = 40, v = 1): Grid {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(v))
}

function run(input: Record<string, unknown>) {
  const out = polylineRoadSpline({ inputGrid: openGround(), ...input })
  expect(out.error).toBeUndefined()
  return out as { outputGrid: Grid; cellCount: number }
}

/** 道路格是否构成单个 8-连通分量。 */
function isSingleComponent(grid: Grid): boolean {
  const rows = grid.length, cols = grid[0].length
  let start: [number, number] | null = null
  let total = 0
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] !== 0) { total++; start ??= [r, c] }
  if (!start) return false

  const seen = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false))
  const queue: [number, number][] = [start]
  seen[start[0]][start[1]] = true
  let visited = 0
  while (queue.length) {
    const [r, c] = queue.pop()!
    visited++
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr, nc = c + dc
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
        if (grid[nr][nc] === 0 || seen[nr][nc]) continue
        seen[nr][nc] = true
        queue.push([nr, nc])
      }
  }
  return visited === total
}

describe('polyline_road_spline', () => {
  const points = [[4, 4], [14, 30], [26, 8], [36, 34]]

  it('道路穿过每一个控制点', () => {
    const { outputGrid } = run({ points, roadWidth: 1 })
    for (const [col, row] of points) expect(outputGrid[row][col]).toBe(1)
  })

  it('回折路线不被按 x 重排，控制点顺序保留', () => {
    // col 先增后减再增：river_spline 会按 x 排序打乱，本电池必须原样穿过
    const zigzag = [[5, 5], [30, 12], [8, 22], [32, 34]]
    const { outputGrid } = run({ points: zigzag, roadWidth: 1 })
    for (const [col, row] of zigzag) expect(outputGrid[row][col]).toBe(1)
  })

  it('细路也 8-连通不断线，且采样数极小时同样连续', () => {
    expect(isSingleComponent(run({ points, roadWidth: 1 }).outputGrid)).toBe(true)
    expect(isSingleComponent(run({ points, roadWidth: 0.5, samplesPerSegment: 1 }).outputGrid)).toBe(true)
  })

  it('只输出道路本身，宽度越大道路格越多', () => {
    const narrow = run({ points, roadWidth: 1 })
    const wide = run({ points, roadWidth: 5 })
    const cells = narrow.outputGrid.flat().filter((v) => v !== 0)
    expect(cells.every((v) => v === 1)).toBe(true)
    expect(narrow.cellCount).toBe(cells.length)
    expect(wide.cellCount).toBeGreaterThan(narrow.cellCount)
    // 足迹是全 1 的 40x40，道路必须只占其中一小部分
    expect(wide.cellCount).toBeLessThan(40 * 40)
  })

  it('clipToFootprint 裁剪到上游足迹', () => {
    const footprint = openGround(40, 40, 0)
    for (let r = 0; r < 20; r++) for (let c = 0; c < 40; c++) footprint[r][c] = 1

    const clipped = polylineRoadSpline({ inputGrid: footprint, points, roadWidth: 3 }) as { outputGrid: Grid }
    for (let r = 20; r < 40; r++)
      for (let c = 0; c < 40; c++) expect(clipped.outputGrid[r][c]).toBe(0)

    const free = polylineRoadSpline({
      inputGrid: footprint, points, roadWidth: 3, clipToFootprint: false,
    }) as { cellCount: number }
    expect(free.cellCount).toBeGreaterThan((clipped as unknown as { cellCount: number }).cellCount)
  })

  it('tension=1 退化为直折线，仍穿过控制点', () => {
    const { outputGrid } = run({ points, roadWidth: 1, tension: 1 })
    for (const [col, row] of points) expect(outputGrid[row][col]).toBe(1)
  })

  // 近 180° 回折的 zigzag：最考验平滑与自交
  const hairpin = [[38, 38], [28, 56], [21, 20], [9, 37]]
  const hairpinRun = (opts: Record<string, unknown>) =>
    polylineRoadSpline({ inputGrid: openGround(64, 64), points: hairpin, roadWidth: 1, ...opts }) as
      { outputGrid: Grid; cellCount: number }

  it('roundness 拓宽回折处的转弯半径，且不破坏穿点与连通性', () => {
    for (const roundness of [0, 1, 1.3, 2.5]) {
      const { outputGrid } = hairpinRun({ roundness })
      for (const [col, row] of hairpin) expect(outputGrid[row][col]).toBe(1)
      expect(isSingleComponent(outputGrid)).toBe(true)
    }
    // 转弯半径拓宽 → 弧长变长（防自交夹持保证不会甩成环）
    expect(hairpinRun({ roundness: 2.5 }).cellCount).toBeGreaterThan(hairpinRun({ roundness: 1 }).cellCount)
  })

  it('默认参数确实在弯：弧长明显长于 tension=1 的直折线', () => {
    expect(hairpinRun({}).cellCount).toBeGreaterThan(hairpinRun({ tension: 1 }).cellCount)
  })

  describe('reinforceJoints', () => {
    /**
     * 弱接缝：2×2 只缺 1 格，且缺口两侧直路段至少持续 2 格（即两段直路只靠一格搭接）。
     * 判定只看加固前的掩码——加固后路缘本身会出现新的 2×2 缺口，那是正常的路缘台阶。
     */
    function weakJoints(grid: Grid): Array<[number, number]> {
      const rows = grid.length, cols = grid[0].length
      const road = (r: number, c: number) => r >= 0 && r < rows && c >= 0 && c < cols && grid[r][c] !== 0
      const found: Array<[number, number]> = []
      for (let r = 0; r + 1 < rows; r++)
        for (let c = 0; c + 1 < cols; c++) {
          const cells: Array<[number, number]> = [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]]
          const empty = cells.filter(([er, ec]) => !road(er, ec))
          if (empty.length !== 1) continue
          const [nr, nc] = empty[0]
          const or_ = nr === r ? r + 1 : r
          const oc = nc === c ? c + 1 : c
          if (road(nr + (nr - or_), oc) || road(or_, nc + (nc - oc))) found.push(empty[0])
        }
      return found
    }
    /** 每 3 行错一格的陡坡：接缝密集 */
    const steep = (opts: Record<string, unknown>) =>
      polylineRoadSpline({ inputGrid: openGround(40, 28), points: [[6, 2], [16, 37]], roadWidth: 2, ...opts }) as
        { outputGrid: Grid; cellCount: number }

    it('补掉换向台阶处的弱接缝，接缝不再只靠一格搭接', () => {
      const bare = steep({ reinforceJoints: false }).outputGrid
      const weak = weakJoints(bare)
      expect(weak.length).toBeGreaterThan(0)
      const fixed = steep({}).outputGrid
      for (const [r, c] of weak) expect(fixed[r][c]).toBe(1)
      expect(steep({}).cellCount).toBeGreaterThan(steep({ reinforceJoints: false }).cellCount)
    })

    it('连续 45° 斜路不算换向，不会被加粗', () => {
      const diag = (opts: Record<string, unknown>) =>
        polylineRoadSpline({ inputGrid: openGround(40, 40), points: [[2, 2], [36, 36]], roadWidth: 2, ...opts }) as
          { cellCount: number }
      expect(diag({}).cellCount).toBe(diag({ reinforceJoints: false }).cellCount)
    })

    it('补格受足迹裁剪约束，不会溢出上游区域', () => {
      const footprint = openGround(40, 28, 0)
      for (let r = 0; r < 40; r++) for (let c = 0; c < 12; c++) footprint[r][c] = 1
      const out = polylineRoadSpline({
        inputGrid: footprint, points: [[6, 2], [16, 37]], roadWidth: 2,
      }) as { outputGrid: Grid }
      for (let r = 0; r < 40; r++)
        for (let c = 12; c < 28; c++) expect(out.outputGrid[r][c]).toBe(0)
    })
  })

  it('确定性：同输入同输出', () => {
    expect(run({ points }).outputGrid).toEqual(run({ points }).outputGrid)
  })

  it('points 是 access:list 端口：point2d 列表与整份数组两种形状都能吃', () => {
    // 画布上的接法：多个 pt2_construct → tree_merge → points，dispatcher 交来 point2d 列表
    const asPoint2d = points.map(([x, y]) => ({ x, y }))
    expect(run({ points: asPoint2d, roadWidth: 1 }).outputGrid).toEqual(run({ points, roadWidth: 1 }).outputGrid)

    // 整份字面量作为单个 item 传入时，dispatcher 会包成长度 1 的列表
    expect(run({ points: [points], roadWidth: 1 }).outputGrid).toEqual(run({ points, roadWidth: 1 }).outputGrid)
    expect(run({ points: [JSON.stringify(points)], roadWidth: 1 }).outputGrid).toEqual(run({ points, roadWidth: 1 }).outputGrid)
  })

  it('控制点不足 2 个不重复点时报错', () => {
    expect(polylineRoadSpline({ inputGrid: openGround(), points: [[3, 3]] }).error).toBeTruthy()
    expect(polylineRoadSpline({ inputGrid: openGround(), points: [[3, 3], [3, 3]] }).error).toBeTruthy()
    expect(polylineRoadSpline({ inputGrid: [], points }).error).toBeTruthy()
  })
})
