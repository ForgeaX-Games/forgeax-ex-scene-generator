/**
 * image_black_collision — 黑白图 → 碰撞轮廓 + 锚点
 *
 * 把输入位图按灰度阈值二值化（灰度 < threshold 且非全透明 = 「黑色区域」），
 * 然后产出三类下游数据：
 *   1. collision_grid (grid) — 与图等尺寸的二值轮廓矩阵（外轮廓像素=1，其余=0）
 *   2. collision      (string) — 多连通区域的有序顶点环 JSON `[[[x,y],...], ...]`
 *                                （Moore 边界跟踪 + 可选 Douglas–Peucker 简化，像素坐标）
 *   3. anchor         (string) — 黑色区域质心 `{"x":cx,"y":cy}`（像素坐标）
 *
 * I/O：经 `decodeInputImage`（_shared/asset2d.ts）委托后端 asset2d.decodeImage
 * 把 ImageRef 解码为 RGBA，再跑纯算法。纯算法以 `_` 前缀导出供单测，唯一小写
 * 开头导出函数 `imageBlackCollision` 作为 loader entry（铁律见 image_pixel_scale）。
 */

import { decodeInputImage, type DecodedImage } from '../../../_shared/asset2d.js'

export async function imageBlackCollision(
  input: Record<string, unknown>,
  ctx?: { services?: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const threshold = typeof input.threshold === 'number' ? input.threshold : 128
  const simplify = typeof input.simplify === 'number' ? Math.max(0, input.simplify) : 1.5

  const dec = decodeInputImage(input, ctx)
  if (!dec.image) {
    return { collision_grid: [], collision: '[]', anchor: '{}', error: dec.error ?? 'decode failed' }
  }
  const { width, height, data } = dec.image
  const src = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)

  const mask = _binarize(src, width, height, threshold)
  const grid = _outlineGrid(mask, width, height)
  const rings = _traceContours(mask, width, height, simplify)
  const anchor = _centroid(mask, width, height)

  if (!anchor) {
    return { collision_grid: grid, collision: '[]', anchor: '{}', error: 'no black region found' }
  }

  return {
    collision_grid: grid,
    collision: JSON.stringify(rings),
    anchor: JSON.stringify(anchor),
    error: '',
  }
}

/** 二值化：灰度 < threshold 且 alpha>0 视为「黑」(true)。导出供单测。 */
export function _binarize(src: Uint8Array, w: number, h: number, threshold: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const r = src[i * 4], g = src[i * 4 + 1], b = src[i * 4 + 2], a = src[i * 4 + 3]
    if (a === 0) { out[i] = 0; continue }
    const gray = 0.299 * r + 0.587 * g + 0.114 * b
    out[i] = gray < threshold ? 1 : 0
  }
  return out
}

/** 黑像素质心（像素坐标，四舍五入）。无黑像素返回 null。导出供单测。 */
export function _centroid(mask: Uint8Array, w: number, h: number): { x: number; y: number } | null {
  let sx = 0, sy = 0, n = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) { sx += x; sy += y; n++ }
    }
  }
  if (n === 0) return null
  return { x: Math.round(sx / n), y: Math.round(sy / n) }
}

/** 外轮廓二值 grid：黑像素且 4 邻域中至少一个为非黑（或越界）→ 1。导出供单测。 */
export function _outlineGrid(mask: Uint8Array, w: number, h: number): number[][] {
  const grid: number[][] = Array.from({ length: h }, () => new Array(w).fill(0))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      const up = y === 0 || !mask[(y - 1) * w + x]
      const dn = y === h - 1 || !mask[(y + 1) * w + x]
      const lf = x === 0 || !mask[y * w + (x - 1)]
      const rt = x === w - 1 || !mask[y * w + (x + 1)]
      if (up || dn || lf || rt) grid[y][x] = 1
    }
  }
  return grid
}

type Point = [number, number]

/**
 * Moore 边界跟踪：对每个未访问的连通黑色区域勾出其外轮廓有序顶点环，可选用
 * Douglas–Peucker 简化。返回 `[[ [x,y], ... ], ...]`（每个区域一个环）。导出供单测。
 */
export function _traceContours(mask: Uint8Array, w: number, h: number, epsilon: number): Point[][] {
  const at = (x: number, y: number): boolean => x >= 0 && x < w && y >= 0 && y < h && mask[y * w + x] === 1
  // 8 邻域顺时针方向（从正左开始），用于 Moore 跟踪
  const dirs: Point[] = [
    [-1, 0], [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1],
  ]
  // 标记已被某条轮廓「起点」消费过的区域，避免重复跟踪同一外环。
  const claimed = new Uint8Array(w * h)
  const rings: Point[][] = []

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!at(x, y)) continue
      const isLeftEdge = !at(x - 1, y)
      if (!isLeftEdge) continue
      // 该黑像素是其所在行左边界；若其所属连通块已被跟踪过则跳过。
      if (claimed[y * w + x]) continue

      const ring = _mooreTrace(at, dirs, x, y)
      // 标记本环覆盖的整块（用环 bbox 内 flood 标记开销大，这里仅标记环上像素的
      // 行左边界点即可避免对同一外环重复起跳：把环上所有像素 claimed）。
      for (const [px, py] of ring) {
        if (px >= 0 && px < w && py >= 0 && py < h) claimed[py * w + px] = 1
      }
      const simplified = epsilon > 0 ? _douglasPeucker(ring, epsilon) : ring
      if (simplified.length >= 3) rings.push(simplified)
    }
  }
  return rings
}

/** 单连通块 Moore 边界跟踪，返回轮廓像素序列（首尾不重复）。 */
function _mooreTrace(at: (x: number, y: number) => boolean, dirs: Point[], sx: number, sy: number): Point[] {
  const ring: Point[] = []
  const start: Point = [sx, sy]
  let cur: Point = start
  // 进入方向：从左侧进入（backtrack 在正左）
  let backtrackDir = 0
  const maxSteps = 1_000_000
  let steps = 0
  do {
    ring.push([cur[0], cur[1]])
    // 从 backtrack 的下一个方向开始顺时针找下一个黑像素
    let found = false
    for (let i = 0; i < 8; i++) {
      const d = (backtrackDir + 1 + i) % 8
      const nx = cur[0] + dirs[d][0]
      const ny = cur[1] + dirs[d][1]
      if (at(nx, ny)) {
        // 新的 backtrack 方向 = 从新点指回当前点的方向
        backtrackDir = (d + 4) % 8
        cur = [nx, ny]
        found = true
        break
      }
    }
    if (!found) break // 孤立像素
    steps++
  } while ((cur[0] !== start[0] || cur[1] !== start[1]) && steps < maxSteps)
  return ring
}

/** Douglas–Peucker 折线简化（闭合环：保留首点、按最大偏差点递归）。导出供单测。 */
export function _douglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points.slice()
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1

  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const [lo, hi] = stack.pop()!
    let maxD = -1
    let idx = -1
    for (let i = lo + 1; i < hi; i++) {
      const d = _perpDist(points[i], points[lo], points[hi])
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD > epsilon && idx !== -1) {
      keep[idx] = 1
      stack.push([lo, idx], [idx, hi])
    }
  }
  const out: Point[] = []
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i])
  return out
}

function _perpDist(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len = Math.hypot(dx, dy)
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len
}

export type { DecodedImage }
