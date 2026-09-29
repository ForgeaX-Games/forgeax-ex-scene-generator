import { asHeightField, isPoint, type HeightField, type Point } from './spatial.js'

export type { HeightField, Point }
export {
  asHeightField,
  isPoint,
} from './spatial.js'

/** Mix two integers into a deterministic uint32. */
export function hashSeed(seed: number, salt: number): number {
  let x = (seed ^ (salt * 0x9e3779b9)) >>> 0
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return x >>> 0
}

/** Deterministic mulberry32 in [0, 1). */
export function createRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function asPoint(value: unknown): Point | null {
  if (isPoint(value)) return [Number(value[0]), Number(value[1])]
  if (value && typeof value === 'object') {
    const record = value as { x?: unknown; y?: unknown }
    if (record.x !== undefined && record.y !== undefined) {
      const x = Number(record.x)
      const y = Number(record.y)
      return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
    }
  }
  return null
}

export function asPointList(value: unknown): Point[] {
  if (Array.isArray(value)) {
    if (
      value.length >= 2
      && typeof value[0] === 'number'
      && typeof value[1] === 'number'
      && (value.length === 2 || typeof value[2] !== 'object')
    ) {
      const single = asPoint(value)
      if (single && value.every((item) => typeof item === 'number')) return [single]
    }
    return value.flatMap((item) => {
      const point = asPoint(item)
      return point ? [point] : asPointList(item)
    })
  }
  if (value && typeof value === 'object' && Array.isArray((value as { points?: unknown }).points)) {
    return asPointList((value as { points: unknown }).points)
  }
  const point = asPoint(value)
  return point ? [point] : []
}

export function dist(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

export function lerp(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

export function polylineLength(points: readonly Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1]!, points[i]!)
  return total
}

export function alongPolyline(points: readonly Point[], t: number): Point {
  if (points.length === 0) return [0, 0]
  if (points.length === 1 || t <= 0) return points[0]!
  if (t >= 1) return points[points.length - 1]!
  const total = polylineLength(points)
  let remain = total * t
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const seg = dist(a, b)
    if (remain <= seg) return lerp(a, b, seg <= 1e-6 ? 0 : remain / seg)
    remain -= seg
  }
  return points[points.length - 1]!
}

export function resamplePolyline(points: readonly Point[], spacing: number): Point[] {
  if (points.length < 2) return [...points]
  const step = Math.max(spacing, 1e-6)
  const out: Point[] = [points[0]!]
  let carry = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    let remaining = dist(a, b)
    let cursor = a
    while (carry + remaining >= step) {
      const t = (step - carry) / remaining
      const next = lerp(cursor, b, t)
      out.push(next)
      remaining -= step - carry
      cursor = next
      carry = 0
    }
    carry += remaining
  }
  out.push(points[points.length - 1]!)
  return out
}

export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    const intersect = ((a[1] > point[1]) !== (b[1] > point[1]))
      && (point[0] < (b[0] - a[0]) * (point[1] - a[1]) / ((b[1] - a[1]) || 1) + a[0])
    if (intersect) inside = !inside
  }
  return inside
}

export function normalOf(a: Point, b: Point): Point {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  return [-dy / len, dx / len]
}

export function centroidOf(polygon: readonly Point[]): Point {
  if (polygon.length === 0) return [0, 0]
  let x = 0
  let y = 0
  for (const point of polygon) {
    x += point[0]
    y += point[1]
  }
  return [x / polygon.length, y / polygon.length]
}

export function polygonArea(polygon: readonly Point[]): number {
  let area = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!
    const b = polygon[(i + 1) % polygon.length]!
    area += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(area) * 0.5
}

export interface Aabb {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function aabbOf(points: readonly Point[], pad = 0): Aabb {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad }
}

/**
 * Bilinear sample of stored metres. `source` is a Heightfield leaf or raw `number[][]`.
 */
export function sampleHeight(
  source: HeightField | ReadonlyArray<readonly number[]>,
  point: Point,
  cellSize = 1,
): number {
  const field = asHeightField(source, cellSize)
  const values = field?.values
  if (!field || !values || values.length === 0 || (values[0]?.length ?? 0) === 0) return 0
  const origin = field.origin ?? [0, 0]
  const cell = field.cellSize || 1
  const rows = values.length
  const cols = values[0]!.length
  const fx = (point[0] - origin[0]) / cell
  const fy = (point[1] - origin[1]) / cell
  const x0 = Math.max(0, Math.min(cols - 1, Math.floor(fx)))
  const y0 = Math.max(0, Math.min(rows - 1, Math.floor(fy)))
  const x1 = Math.max(0, Math.min(cols - 1, x0 + 1))
  const y1 = Math.max(0, Math.min(rows - 1, y0 + 1))
  const tx = Math.max(0, Math.min(1, fx - x0))
  const ty = Math.max(0, Math.min(1, fy - y0))
  const z00 = values[y0]![x0] ?? 0
  const z10 = values[y0]![x1] ?? 0
  const z01 = values[y1]![x0] ?? 0
  const z11 = values[y1]![x1] ?? 0
  return z00 * (1 - tx) * (1 - ty) + z10 * tx * (1 - ty) + z01 * (1 - tx) * ty + z11 * tx * ty
}

/**
 * 2D Euclidean Signed Distance to an arbitrary 2D Polygon.
 * Inside is negative (how far from closest edge in metres), boundary is zero, outside is positive.
 */
export function sdfPolygon2d(point: Point, polygon: readonly Point[]): number {
  const n = polygon.length
  if (n < 3) return Infinity
  const px = point[0]
  const py = point[1]

  let minSqDist = Infinity
  let inside = false

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = polygon[j]![0]
    const ay = polygon[j]![1]
    const bx = polygon[i]![0]
    const by = polygon[i]![1]

    const abx = bx - ax
    const aby = by - ay
    const apx = px - ax
    const apy = py - ay

    const segLenSq = abx * abx + aby * aby
    let t = 0
    if (segLenSq > 1e-12) {
      t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / segLenSq))
    }
    const qx = ax + t * abx
    const qy = ay + t * aby
    const dx = px - qx
    const dy = py - qy
    const sqDist = dx * dx + dy * dy
    if (sqDist < minSqDist) {
      minSqDist = sqDist
    }

    const intersect = (ay > py) !== (by > py) && px < ((bx - ax) * (py - ay)) / (by - ay || 1e-12) + ax
    if (intersect) {
      inside = !inside
    }
  }

  const d = Math.sqrt(minSqDist)
  return inside ? -d : d
}
