/**
 * rectFit — 在 01 网格的"1 区域"内，围绕一个采样点贴合一个尽量接近目标宽高的矩形。
 *
 * 约定：
 *   - 网格行优先 region[row][col]，非零视为有效（"1 区域"）。
 *   - 采样点 point2d {x,y}：x→列(col)，y→行(row)，四舍五入并夹到边界。
 *   - 结果矩形必须"完整落在 1 区域内"（所有格非零），并"包含锚点格"，以此锚定在点附近；
 *     放不下目标宽高就缩小。region 全 0 时返回 null（调用方输出全 0 网格）。
 *   - 选择优先级（字典序，越小越优）：
 *       1) 宽高亏损最小 (H-h)+(W-w)        —— 长宽尽可能接近输入
 *       2) 面积最大 h*w                     —— 同等亏损下取更大
 *       3) 中心离采样点最近                 —— 中心最接近输入点位
 *       4) 确定性兜底：top 更小、left 更小
 */

export type Grid = number[][]

export interface RectFitInput {
  region: Grid
  /** 采样点 x（列方向） */
  px: number
  /** 采样点 y（行方向） */
  py: number
  /** 目标宽度（列数） */
  width: number
  /** 目标高度（行数） */
  height: number
}

export interface Rect {
  top: number
  left: number
  height: number
  width: number
}

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return Math.max(lo, Math.min(hi, Math.round(v)))
}

/** point2d → 网格行列：x→列(col)，y→行(row)。 */
export function pointToCell(px: number, py: number, rows: number, cols: number): [number, number] {
  return [clampInt(py, 0, rows - 1), clampInt(px, 0, cols - 1)]
}

function buildPrefix(region: Grid, rows: number, cols: number): number[][] {
  const pre = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0))
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const filled = region[r][c] !== 0 ? 1 : 0
      pre[r + 1][c + 1] = filled + pre[r][c + 1] + pre[r + 1][c] - pre[r][c]
    }
  }
  return pre
}

function rectSum(pre: number[][], top: number, left: number, bottom: number, right: number): number {
  return pre[bottom + 1][right + 1] - pre[top][right + 1] - pre[bottom + 1][left] + pre[top][left]
}

function nearestFilled(region: Grid, rows: number, cols: number, pr: number, pc: number): [number, number] | null {
  let best: [number, number] | null = null
  let bestD = Infinity
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (region[r][c] === 0) continue
      const d = (r - pr) ** 2 + (c - pc) ** 2
      if (d < bestD) {
        bestD = d
        best = [r, c]
      }
    }
  }
  return best
}

type Key = [number, number, number, number, number]

function lessKey(a: Key, b: Key): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i]
  }
  return false
}

/**
 * 在区域内寻找最优矩形。region 全 0 返回 null；否则保证至少返回一个 1×1。
 */
export function fitRect(inp: RectFitInput): Rect | null {
  const region = inp.region
  const rows = region.length
  const cols = region[0]?.length ?? 0
  if (rows === 0 || cols === 0) return null

  const pre = buildPrefix(region, rows, cols)
  if (rectSum(pre, 0, 0, rows - 1, cols - 1) === 0) return null // 全 0 区域

  const H = clampInt(inp.height, 1, rows)
  const W = clampInt(inp.width, 1, cols)
  const [pr, pc] = pointToCell(inp.px, inp.py, rows, cols)

  let seedR = pr
  let seedC = pc
  if (region[pr][pc] === 0) {
    const near = nearestFilled(region, rows, cols, pr, pc)
    if (!near) return null
    seedR = near[0]
    seedC = near[1]
  }

  let best: Rect | null = null
  let bestKey: Key | null = null

  const topMin = Math.max(0, seedR - H + 1)
  const leftMin = Math.max(0, seedC - W + 1)
  for (let top = topMin; top <= seedR; top++) {
    const bottomMax = Math.min(rows - 1, top + H - 1)
    for (let bottom = seedR; bottom <= bottomMax; bottom++) {
      const h = bottom - top + 1
      for (let left = leftMin; left <= seedC; left++) {
        const rightMax = Math.min(cols - 1, left + W - 1)
        for (let right = seedC; right <= rightMax; right++) {
          const w = right - left + 1
          const area = h * w
          if (rectSum(pre, top, left, bottom, right) !== area) continue // 非全 1，跳过
          const cy = (top + bottom) / 2
          const cx = (left + right) / 2
          const cdist = (cy - inp.py) ** 2 + (cx - inp.px) ** 2
          const key: Key = [H - h + (W - w), -area, cdist, top, left]
          if (bestKey === null || lessKey(key, bestKey)) {
            bestKey = key
            best = { top, left, height: h, width: w }
          }
        }
      }
    }
  }

  // 理论上锚点格本身的 1×1 必然命中；兜底保证"至少一个点"。
  if (!best) best = { top: seedR, left: seedC, height: 1, width: 1 }
  return best
}

/** 把矩形盖印成与 region 同形状的 01 网格（矩形内 1，其余 0）。 */
export function stampRect(rows: number, cols: number, rect: Rect): Grid {
  const out = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
  for (let r = rect.top; r < rect.top + rect.height; r++) {
    for (let c = rect.left; c < rect.left + rect.width; c++) {
      out[r][c] = 1
    }
  }
  return out
}
