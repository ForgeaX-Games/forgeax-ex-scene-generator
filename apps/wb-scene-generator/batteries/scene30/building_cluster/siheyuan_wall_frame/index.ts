/**
 * siheyuanWallFrame — 四合院围墙：把多个矩形用一个闭合框串起来，穿过每个矩形长边中心线。
 *
 * 输入：
 *   rects     (grid, list) — 矩形列表：0/1 网格列表（每张一个矩形），或单张多值网格
 *                            （每个不同非零 id 视为一个矩形）。
 *   thickness (number)     — 围墙线宽（格数），默认 1。
 *
 * 算法：
 *   1. 归一化输入为一组矩形掩码（多值网格按非零值拆分）。
 *   2. 每个矩形取最小包围盒，长边方向的中心线为其「脊线」（两端点 a、b）。
 *   3. 所有矩形按围绕整体质心的极角排成环形顺序。
 *   4. 贪心首尾相接：脊线 + 连接段串成一条闭合折线（围墙）。
 *   5. Bresenham 光栅化为线宽 thickness 的网格，输出 wall。
 *
 * 坐标约定：x→列、y→行；grid[r][c]。
 */

type Grid = number[][]
type Pt = [number, number] // [row, col]

interface Spine {
  a: Pt
  b: Pt
  center: Pt
}

/** 把输入归一化为一组矩形掩码网格。 */
function normalizeRects(raw: unknown): Grid[] {
  if (!Array.isArray(raw) || raw.length === 0) return []

  // 列表里的元素若是网格（number[][]），则为「矩形网格列表」。
  if (Array.isArray(raw[0]) && Array.isArray((raw[0] as unknown[])[0])) {
    return (raw as Grid[]).filter((g) => Array.isArray(g) && g.length > 0)
  }

  // 否则是单张网格（number[][]）：按不同非零值拆分为多个矩形。
  const grid = raw as Grid
  if (!Array.isArray(grid[0])) return []
  const values = new Set<number>()
  for (const row of grid) {
    for (const v of row) {
      if (Number.isFinite(v) && v !== 0) values.add(v as number)
    }
  }
  if (values.size <= 1) return [grid]

  const rows = grid.length
  const cols = grid[0].length
  const masks: Grid[] = []
  for (const val of values) {
    const mask: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0))
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] === val) mask[r][c] = 1
      }
    }
    masks.push(mask)
  }
  return masks
}

/** 取网格非零单元的最小包围盒。 */
function boundingBox(grid: Grid): { rmin: number; rmax: number; cmin: number; cmax: number } | null {
  let rmin = Infinity
  let rmax = -Infinity
  let cmin = Infinity
  let cmax = -Infinity
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r]
    if (!Array.isArray(row)) continue
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (Number.isFinite(v) && v !== 0) {
        if (r < rmin) rmin = r
        if (r > rmax) rmax = r
        if (c < cmin) cmin = c
        if (c > cmax) cmax = c
      }
    }
  }
  if (rmax < 0) return null
  return { rmin, rmax, cmin, cmax }
}

/** 由包围盒求长边中心线脊线。 */
function spineOf(grid: Grid): Spine | null {
  const bb = boundingBox(grid)
  if (!bb) return null
  const { rmin, rmax, cmin, cmax } = bb
  const w = cmax - cmin + 1
  const h = rmax - rmin + 1
  const cr = Math.round((rmin + rmax) / 2)
  const cc = Math.round((cmin + cmax) / 2)
  // 长边横向 → 中心线水平；长边纵向 → 中心线竖直。
  if (w >= h) {
    return { a: [cr, cmin], b: [cr, cmax], center: [cr, cc] }
  }
  return { a: [rmin, cc], b: [rmax, cc], center: [cr, cc] }
}

function dist2(p: Pt, q: Pt): number {
  const dr = p[0] - q[0]
  const dc = p[1] - q[1]
  return dr * dr + dc * dc
}

/** Bresenham 直线，stamp 线宽 thickness。 */
function drawLine(wall: Grid, p: Pt, q: Pt, half: number, rows: number, cols: number): void {
  let [r0, c0] = p
  const [r1, c1] = q
  const dr = Math.abs(r1 - r0)
  const dc = Math.abs(c1 - c0)
  const sr = r0 < r1 ? 1 : -1
  const sc = c0 < c1 ? 1 : -1
  let err = dc - dr
  // eslint-disable-next-line no-constant-condition
  while (true) {
    stamp(wall, r0, c0, half, rows, cols)
    if (r0 === r1 && c0 === c1) break
    const e2 = 2 * err
    if (e2 > -dr) {
      err -= dr
      c0 += sc
    }
    if (e2 < dc) {
      err += dc
      r0 += sr
    }
  }
}

function stamp(wall: Grid, r: number, c: number, half: number, rows: number, cols: number): void {
  for (let dr = -half; dr <= half; dr++) {
    for (let dc = -half; dc <= half; dc++) {
      const rr = r + dr
      const cc = c + dc
      if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) wall[rr][cc] = 1
    }
  }
}

export function siheyuanWallFrame(input: Record<string, unknown>): Record<string, unknown> {
  const rects = normalizeRects(input.rects)
  if (rects.length === 0) {
    return { error: 'rects is required: a list of 0/1 grids, or one multi-value grid' }
  }

  const thicknessRaw = typeof input.thickness === 'number' ? input.thickness : 1
  const thickness = Number.isFinite(thicknessRaw) && thicknessRaw >= 1 ? Math.round(thicknessRaw) : 1
  const half = Math.floor((thickness - 1) / 2)

  // 输出网格尺寸：取所有输入网格的最大行列，避免越界。
  let rows = 0
  let cols = 0
  for (const g of rects) {
    rows = Math.max(rows, g.length)
    for (const row of g) cols = Math.max(cols, Array.isArray(row) ? row.length : 0)
  }
  if (rows === 0 || cols === 0) return { error: 'rects contains only empty grids' }

  const spines: Spine[] = []
  for (const g of rects) {
    const s = spineOf(g)
    if (s) spines.push(s)
  }
  if (spines.length === 0) return { error: 'no non-empty rectangle found in rects' }

  // 围绕整体质心的极角排序，形成环。
  let gr = 0
  let gc = 0
  for (const s of spines) {
    gr += s.center[0]
    gc += s.center[1]
  }
  gr /= spines.length
  gc /= spines.length
  spines.sort((s1, s2) => Math.atan2(s1.center[0] - gr, s1.center[1] - gc) - Math.atan2(s2.center[0] - gr, s2.center[1] - gc))

  // 贪心首尾相接成闭合折线。
  const path: Pt[] = [spines[0].a, spines[0].b]
  let cur: Pt = spines[0].b
  for (let i = 1; i < spines.length; i++) {
    const s = spines[i]
    const entry = dist2(cur, s.a) <= dist2(cur, s.b) ? s.a : s.b
    const exit = entry === s.a ? s.b : s.a
    path.push(entry, exit)
    cur = exit
  }
  path.push(spines[0].a) // 闭合回起点

  const wall: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0))
  for (let i = 0; i + 1 < path.length; i++) {
    drawLine(wall, path[i], path[i + 1], half, rows, cols)
  }

  return { wall }
}
