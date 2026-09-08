/**
 * randomRectScatter — 在输入点位周围随机生成矩形。
 *
 * 对每个输入点，生成 countPerPoint 个矩形：随机方向、与点保持「distance ± distanceJitter」的
 * 中心距、随机宽高（minSize..maxSize）。矩形按 region 网格边界裁剪。
 *
 * 输入：
 *   region         (grid)        — 区域/画布网格，仅定义输出尺寸
 *   points         (point2d,list) — 中心点集，x→列、y→行
 *   countPerPoint  (number)      — 每点矩形数，默认 3
 *   distance       (number)      — 矩形与点的大致中心距，默认 6
 *   distanceJitter (number)      — 距离随机波动 ±，默认 2
 *   minSize/maxSize(number)      — 矩形边长范围，默认 2..5
 *   seed           (number)      — 随机种子，0=当前时间
 *
 * 输出：
 *   outputGrid (grid)      — 多值网格，每个矩形递增 id
 *   rects      (grid,list) — 每个矩形一张 0/1 网格
 *
 * 坐标约定：x→列、y→行；grid[r][c]。
 */

type Grid = number[][]

class SeededRandom {
  private s: number

  constructor(seed: number) {
    this.s = seed === 0 ? Date.now() >>> 0 : (Math.abs(Math.round(seed)) >>> 0) || 1
    for (let i = 0; i < 8; i++) this.next()
  }

  next(): number {
    this.s = (this.s * 1664525 + 1013904223) >>> 0
    return this.s / 0xffffffff
  }

  /** 连续区间 [min, max) 随机。 */
  range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** 整数区间 [min, max] 随机（含端点）。 */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

export function randomRectScatter(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined
  if (!region || region.length === 0 || !Array.isArray(region[0]) || region[0].length === 0) {
    return { error: 'region is required and must be a non-empty grid' }
  }
  const rows = region.length
  const cols = region[0].length

  const rawPoints = input.points
  const points = Array.isArray(rawPoints) ? rawPoints : rawPoints == null ? [] : [rawPoints]
  if (points.length === 0) {
    return { outputGrid: Array.from({ length: rows }, () => new Array(cols).fill(0)), rects: [] }
  }

  const countPerPoint = Math.max(1, Math.round(num(input.countPerPoint, 3)))
  const distance = Math.max(0, num(input.distance, 6))
  const distanceJitter = Math.max(0, num(input.distanceJitter, 2))
  let minSize = Math.max(1, Math.round(num(input.minSize, 2)))
  let maxSize = Math.max(1, Math.round(num(input.maxSize, 5)))
  if (maxSize < minSize) {
    const t = minSize
    minSize = maxSize
    maxSize = t
  }
  const seed = num(input.seed, 0)

  const rng = new SeededRandom(seed)
  const outputGrid: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0))
  const rects: Grid[] = []
  let id = 0

  for (let pi = 0; pi < points.length; pi++) {
    const p = points[pi] as { x?: unknown; y?: unknown } | null | undefined
    const px = Number(p?.x)
    const py = Number(p?.y)
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      return { error: `points[${pi}] must be a point2d {x,y}` }
    }

    for (let k = 0; k < countPerPoint; k++) {
      const angle = rng.next() * Math.PI * 2
      const d = Math.max(0, distance + rng.range(-distanceJitter, distanceJitter))
      const w = rng.int(minSize, maxSize)
      const h = rng.int(minSize, maxSize)

      const ccol = px + Math.cos(angle) * d // x→列
      const crow = py + Math.sin(angle) * d // y→行
      const c0 = Math.round(ccol - w / 2)
      const c1 = c0 + w - 1
      const r0 = Math.round(crow - h / 2)
      const r1 = r0 + h - 1

      id += 1
      const mask: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0))
      for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
        for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
          outputGrid[r][c] = id
          mask[r][c] = 1
        }
      }
      rects.push(mask)
    }
  }

  return { outputGrid, rects }
}
