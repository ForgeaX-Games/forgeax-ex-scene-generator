/**
 * rectsFit — 在 01 区域网格内为一组采样点各自贴合一个矩形，且矩形之间互不重叠。
 *
 * 与 point2rect 的单点版同源：每个矩形都要求"完整落在有效格内、包含锚点、中心尽量贴近
 * 采样点、长宽尽量接近输入"，放不下就缩小。多点版在此基础上保证非重叠——做法是维护一张
 * 可用掩码 available（region 非零且尚未被占用的格为 1），逐个矩形在 available 上贴合后把
 * 占用的格从 available 中扣除，于是后续矩形天然不会与已放矩形重叠。
 *
 * 约定：
 *   - 网格行优先 grid[row][col]，非零视为有效。
 *   - 采样点 point2d {x,y}：x→列(col)，y→行(row)。
 *   - 放置优先级：目标面积大者先放（area-desc），同面积按输入顺序（稳定）。先放的占据更优位置。
 *   - 输出按输入原始顺序返回；放不下的点对应一张同形状全 0 网格。
 *
 * 单矩形选择优先级（字典序，越小越优）——与 point2rect 完全一致：
 *   1) 宽高亏损最小 (H-h)+(W-w)        —— 长宽尽可能接近输入
 *   2) 面积最大 h*w                     —— 同等亏损下取更大
 *   3) 中心离采样点最近                 —— 中心最接近输入点位
 *   4) 确定性兜底：top 更小、left 更小
 */

export type Grid = number[][]

export interface Rect {
  top: number
  left: number
  height: number
  width: number
}

export interface RectRequest {
  /** 采样点 x（列方向） */
  px: number
  /** 采样点 y（行方向） */
  py: number
  /** 目标宽度（列数） */
  width: number
  /** 目标高度（行数） */
  height: number
}

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return Math.max(lo, Math.min(hi, Math.round(v)))
}

/** point2d → 网格行列：x→列(col)，y→行(row)。 */
export function pointToCell(px: number, py: number, rows: number, cols: number): [number, number] {
  return [clampInt(py, 0, rows - 1), clampInt(px, 0, cols - 1)]
}

function buildPrefix(avail: Grid, rows: number, cols: number): number[][] {
  const pre = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0))
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const filled = avail[r][c] !== 0 ? 1 : 0
      pre[r + 1][c + 1] = filled + pre[r][c + 1] + pre[r + 1][c] - pre[r][c]
    }
  }
  return pre
}

function rectSum(pre: number[][], top: number, left: number, bottom: number, right: number): number {
  return pre[bottom + 1][right + 1] - pre[top][right + 1] - pre[bottom + 1][left] + pre[top][left]
}

function nearestFilled(avail: Grid, rows: number, cols: number, pr: number, pc: number): [number, number] | null {
  let best: [number, number] | null = null
  let bestD = Infinity
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (avail[r][c] === 0) continue
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
 * 在可用掩码 avail 内围绕采样点贴合一个矩形。avail 全 0 返回 null；否则保证至少返回一个 1×1。
 * avail 必须是 0/1（1=可用）。
 */
export function fitRectIn(avail: Grid, req: RectRequest): Rect | null {
  const rows = avail.length
  const cols = avail[0]?.length ?? 0
  if (rows === 0 || cols === 0) return null

  const pre = buildPrefix(avail, rows, cols)
  if (rectSum(pre, 0, 0, rows - 1, cols - 1) === 0) return null // 无可用格

  const H = clampInt(req.height, 1, rows)
  const W = clampInt(req.width, 1, cols)
  const [pr, pc] = pointToCell(req.px, req.py, rows, cols)

  let seedR = pr
  let seedC = pc
  if (avail[pr][pc] === 0) {
    const near = nearestFilled(avail, rows, cols, pr, pc)
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
          if (rectSum(pre, top, left, bottom, right) !== area) continue // 含不可用格，跳过
          const cy = (top + bottom) / 2
          const cx = (left + right) / 2
          const cdist = (cy - req.py) ** 2 + (cx - req.px) ** 2
          const key: Key = [H - h + (W - w), -area, cdist, top, left]
          if (bestKey === null || lessKey(key, bestKey)) {
            bestKey = key
            best = { top, left, height: h, width: w }
          }
        }
      }
    }
  }

  if (!best) best = { top: seedR, left: seedC, height: 1, width: 1 }
  return best
}

/** 把矩形盖印成与给定形状同形的 01 网格（矩形内 1，其余 0）。 */
export function stampRect(rows: number, cols: number, rect: Rect): Grid {
  const out = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
  for (let r = rect.top; r < rect.top + rect.height; r++) {
    for (let c = rect.left; c < rect.left + rect.width; c++) {
      out[r][c] = 1
    }
  }
  return out
}

export interface PlaceRectsResult {
  /** 每个请求对应一张同形状 0/1 网格，顺序与输入 requests 一致；放不下为全 0 网格。 */
  grids: Grid[]
  /** 每个请求对应的矩形（放不下为 null），顺序与输入一致。 */
  rects: Array<Rect | null>
  /** 成功放置（非空）的矩形数量。 */
  placedCount: number
}

/**
 * 为一组请求在 region 内贴合互不重叠的矩形。
 * region 非零格视为有效；处理顺序按目标面积从大到小（同面积按输入顺序），结果按输入原顺序返回。
 */
export function placeRects(region: Grid, requests: readonly RectRequest[]): PlaceRectsResult {
  const rows = region.length
  const cols = region[0]?.length ?? 0
  const grids: Grid[] = requests.map(() => stampRect(rows, cols, { top: 0, left: 0, height: 0, width: 0 }))
  const rects: Array<Rect | null> = requests.map(() => null)

  if (rows === 0 || cols === 0 || requests.length === 0) {
    return { grids, rects, placedCount: 0 }
  }

  // 可用掩码：region 非零 → 1，否则 0。后续放置会在此基础上扣除已占用格。
  const avail: Grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => (region[r][c] !== 0 ? 1 : 0)),
  )

  // 按目标面积降序排序，保留原始下标；同面积按原始下标升序（稳定、确定性）。
  const order = requests.map((req, index) => ({ req, index }))
  order.sort((a, b) => {
    const areaA = Math.max(1, a.req.width) * Math.max(1, a.req.height)
    const areaB = Math.max(1, b.req.width) * Math.max(1, b.req.height)
    if (areaA !== areaB) return areaB - areaA
    return a.index - b.index
  })

  let placedCount = 0
  for (const { req, index } of order) {
    const rect = fitRectIn(avail, req)
    if (!rect) continue // 已无可用空间
    rects[index] = rect
    grids[index] = stampRect(rows, cols, rect)
    placedCount += 1
    // 从可用掩码中扣除该矩形占用的格，保证后续不重叠。
    for (let r = rect.top; r < rect.top + rect.height; r++) {
      for (let c = rect.left; c < rect.left + rect.width; c++) {
        avail[r][c] = 0
      }
    }
  }

  return { grids, rects, placedCount }
}
