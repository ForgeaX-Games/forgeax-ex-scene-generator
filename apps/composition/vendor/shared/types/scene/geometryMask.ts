/**
 * Burn operating Geometry into a same-lattice 0–1 Grid.
 * Lattice is plane + columns + rows. Not a Heightfield op.
 */

import { heightfieldStretchMetrics, type HeightfieldStretchMetrics } from './heightfield.js'
import { asPlane, unwrapSpatialWireValue, type Plane } from './spatial.js'
import { sampleOpenSpline, type Vec2 } from './spline.js'

export interface GeometryMaskWarning {
  code: string
  message: string
  [key: string]: unknown
}

export interface GeometryMaskBuild {
  grid: number[][]
  error?: string
  _warnings: GeometryMaskWarning[]
}

function zeros(rows: number, columns: number): number[][] {
  const r = Math.max(1, Math.floor(Number(rows)) || 1)
  const c = Math.max(1, Math.floor(Number(columns)) || 1)
  return Array.from({ length: r }, () => Array.from({ length: c }, () => 0))
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

function asXY(value: unknown): Vec2 | null {
  const raw = unwrapSpatialWireValue(value)
  if (Array.isArray(raw) && raw.length >= 2) {
    const x = Number(raw[0])
    const y = Number(raw[1])
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
  }
  if (raw && typeof raw === 'object') {
    const rec = raw as { kind?: unknown; geometry?: unknown; x?: unknown; y?: unknown }
    if (rec.geometry !== undefined) return asXY(rec.geometry)
    const x = Number(rec.x)
    const y = Number(rec.y)
    if (Number.isFinite(x) && Number.isFinite(y)) return [x, y]
  }
  return null
}

function asXYList(value: unknown): Vec2[] | null {
  const raw = unwrapSpatialWireValue(value)
  if (!Array.isArray(raw) || raw.length === 0) return null
  const points: Vec2[] = []
  for (const item of raw) {
    const point = asXY(item)
    if (!point) return null
    points.push(point)
  }
  return points
}

function asRing(value: unknown): Vec2[] | null {
  const list = asXYList(value)
  if (list) return list
  const geom = unwrapGeometry(value)
  return geom ? asXYList(geom.points) : null
}

function unwrapGeometry(value: unknown, depth = 0): Record<string, unknown> | null {
  if (value == null || depth > 8) return null
  const raw = unwrapSpatialWireValue(value)
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (typeof rec.kind === 'string') return rec
  if (rec.geometry !== undefined) return unwrapGeometry(rec.geometry, depth + 1)
  if (Array.isArray(raw) && raw.length === 1) return unwrapGeometry(raw[0], depth + 1)
  return null
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-18) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Distance to a polyline, prepared once per mask instead of walked per cell.
 *
 * A densified road spline is thousands of segments spread across the whole
 * plane, so for any one cell nearly all of them are far away. The per-segment
 * box test is an exact lower bound on the segment distance, so culling by it
 * against the running best returns the identical number for far fewer hypots.
 */
function preparePolyline(points: readonly Vec2[]): (px: number, py: number) => number {
  if (points.length === 0) return () => Infinity
  if (points.length === 1) {
    const [ax, ay] = points[0]!
    return (px, py) => Math.hypot(px - ax, py - ay)
  }
  const count = points.length - 1
  const seg = new Float64Array(count * 4)
  const box = new Float64Array(count * 4)
  for (let i = 0; i < count; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const o = i * 4
    seg[o] = a[0]
    seg[o + 1] = a[1]
    seg[o + 2] = b[0]
    seg[o + 3] = b[1]
    box[o] = Math.min(a[0], b[0])
    box[o + 1] = Math.min(a[1], b[1])
    box[o + 2] = Math.max(a[0], b[0])
    box[o + 3] = Math.max(a[1], b[1])
  }
  // Masks are filled row by row, so consecutive queries are neighbouring cells and
  // the previous winner is almost always a tight bound. Seeding with it makes the
  // box test cull from the first segment instead of after `best` has crept down.
  let seed = 0
  return (px, py) => {
    const s = seed * 4
    let best = distToSegment(px, py, seg[s]!, seg[s + 1]!, seg[s + 2]!, seg[s + 3]!)
    for (let i = 0; i < count; i++) {
      const o = i * 4
      const bx = px < box[o]! ? box[o]! - px : px > box[o + 2]! ? px - box[o + 2]! : 0
      const by = py < box[o + 1]! ? box[o + 1]! - py : py > box[o + 3]! ? py - box[o + 3]! : 0
      if (bx * bx + by * by >= best * best) continue
      const d = distToSegment(px, py, seg[o]!, seg[o + 1]!, seg[o + 2]!, seg[o + 3]!)
      if (d < best) {
        best = d
        seed = i
      }
    }
    return best
  }
}

interface Box2 {
  x0: number
  y0: number
  x1: number
  y1: number
}

function polylineBox(points: readonly Vec2[]): Box2 {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const point of points) {
    if (point[0] < x0) x0 = point[0]
    if (point[0] > x1) x1 = point[0]
    if (point[1] < y0) y0 = point[1]
    if (point[1] > y1) y1 = point[1]
  }
  return { x0, y0, x1, y1 }
}

/** True when nothing inside `box` can be closer than `limit`. Squared, so no sqrt per test. */
function boxDistanceExceeds(x: number, y: number, box: Box2, limit: number): boolean {
  const dx = x < box.x0 ? box.x0 - x : x > box.x1 ? x - box.x1 : 0
  const dy = y < box.y0 ? box.y0 - y : y > box.y1 ? y - box.y1 : 0
  return dx * dx + dy * dy >= limit * limit
}

function segmentHitsRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const minX = Math.min(ax, bx)
  const maxX = Math.max(ax, bx)
  const minY = Math.min(ay, by)
  const maxY = Math.max(ay, by)
  if (maxX < x0 || minX > x1 || maxY < y0 || minY > y1) return false
  if (
    (ax >= x0 && ax <= x1 && ay >= y0 && ay <= y1)
    || (bx >= x0 && bx <= x1 && by >= y0 && by <= y1)
  ) return true
  const hits = (xA: number, yA: number, xB: number, yB: number, xC: number, yC: number, xD: number, yD: number) => {
    const den = (xB - xA) * (yD - yC) - (yB - yA) * (xD - xC)
    if (Math.abs(den) < 1e-12) return false
    const t = ((xC - xA) * (yD - yC) - (yC - yA) * (xD - xC)) / den
    const u = ((xC - xA) * (yB - yA) - (yC - yA) * (xB - xA)) / den
    return t >= 0 && t <= 1 && u >= 0 && u <= 1
  }
  return (
    hits(ax, ay, bx, by, x0, y0, x1, y0)
    || hits(ax, ay, bx, by, x1, y0, x1, y1)
    || hits(ax, ay, bx, by, x1, y1, x0, y1)
    || hits(ax, ay, bx, by, x0, y1, x0, y0)
  )
}

function polylineHitsCell(points: readonly Vec2[], x0: number, y0: number, x1: number, y1: number): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    if (segmentHitsRect(a[0], a[1], b[0], b[1], x0, y0, x1, y1)) return true
  }
  return false
}

function pointInRing(x: number, y: number, ring: readonly Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    const crosses = (a[1] > y) !== (b[1] > y)
    if (!crosses) continue
    const atX = ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1] || 1e-12) + a[0]
    if (x < atX) inside = !inside
  }
  return inside
}

function densifySpline(points: readonly Vec2[], degree: number): Vec2[] {
  if (points.length < 3 || degree < 2) return points.slice()
  return sampleOpenSpline(points.map((p) => [p[0], p[1]] as Vec2), 24, 0, 1.3)
}

function curvePoints(curve: Record<string, unknown> | null): Vec2[] | null {
  if (!curve) return null
  const points = asXYList(curve.points)
  if (!points || points.length < 2) return null
  return curve.kind === 'spline' ? densifySpline(points, Number(curve.degree) || 3) : points
}

function planeBox(plane: Plane): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = Number(plane.origin[0]) || 0
  const y0 = Number(plane.origin[1]) || 0
  return { x0, y0, x1: x0 + plane.width, y1: y0 + plane.height }
}

function distToAabb(x: number, y: number, box: { x0: number; y0: number; x1: number; y1: number }): number {
  const dx = x < box.x0 ? box.x0 - x : x > box.x1 ? x - box.x1 : 0
  const dy = y < box.y0 ? box.y0 - y : y > box.y1 ? y - box.y1 : 0
  if (dx === 0 && dy === 0) {
    return -Math.min(x - box.x0, box.x1 - x, y - box.y0, box.y1 - y)
  }
  return Math.hypot(dx, dy)
}

function intersectBoxes(
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number },
): { x0: number; y0: number; x1: number; y1: number } | null {
  const x0 = Math.max(a.x0, b.x0)
  const y0 = Math.max(a.y0, b.y0)
  const x1 = Math.min(a.x1, b.x1)
  const y1 = Math.min(a.y1, b.y1)
  if (x1 < x0 || y1 < y0) return null
  return { x0, y0, x1, y1 }
}

function stretchWarning(plane: Plane, columns: number, rows: number): GeometryMaskWarning | undefined {
  const stretch: HeightfieldStretchMetrics = heightfieldStretchMetrics(plane.width, plane.height, columns, rows)
  if (!stretch.anisotropic) return undefined
  return {
    ...stretch,
    code: 'SCENE_GRID_STRETCH',
    message: [
      `Mask grid ${stretch.columns}×${stretch.rows} covers plane ${stretch.planeWidth.toFixed(1)}×${stretch.planeHeight.toFixed(1)} m`,
      `cell ${stretch.cellSizeX.toFixed(3)}×${stretch.cellSizeY.toFixed(3)} m`,
      `stretch ratio ${stretch.stretchRatio.toFixed(3)} (anisotropic)`,
    ].join('; '),
  }
}

type HardQuery = {
  signedDistance: (x: number, y: number) => number
  hitsCell?: (x0: number, y0: number, x1: number, y1: number) => boolean
}

function hardFromGeometry(
  geom: Record<string, unknown>,
  frame: { x0: number; y0: number; x1: number; y1: number },
  width: number,
): { query: HardQuery; error?: string } | { query?: undefined; error: string } {
  const kind = String(geom.kind ?? '')
  const half = Math.max(0, width) / 2
  if (kind === 'mesh' || kind === 'voxel') {
    return { error: 'geometryMask burns operating Geometry only (point2d / plane / polyline / spline / polygon / network)' }
  }
  if (kind === 'point2d') {
    const point = asXY(geom)
    if (!point) return { error: 'point2d requires finite x and y' }
    return {
      query: {
        signedDistance: (x, y) => Math.hypot(x - point[0], y - point[1]) - half,
        hitsCell: (x0, y0, x1, y1) => point[0] >= x0 && point[0] <= x1 && point[1] >= y0 && point[1] <= y1,
      },
    }
  }
  if (kind === 'plane') {
    const plane = asPlane(geom)
    if (!plane || !(plane.width > 0) || !(plane.height > 0)) {
      return { error: 'plane width and height must be positive metres' }
    }
    const hit = intersectBoxes(frame, planeBox(plane))
    if (!hit) {
      return { query: { signedDistance: () => Infinity } }
    }
    return { query: { signedDistance: (x, y) => distToAabb(x, y, hit) } }
  }
  if (kind === 'polygon') {
    const outer = asRing(geom.points)
    if (!outer || outer.length < 3) return { error: 'polygon has fewer than three points' }
    const holes: Vec2[][] = []
    if (Array.isArray(geom.holes)) {
      for (const ring of geom.holes) {
        const hole = asRing(ring)
        if (hole && hole.length >= 3) holes.push(hole)
      }
    }
    const rings = [outer, ...holes]
    return {
      query: {
        signedDistance: (x, y) => {
          const inOuter = pointInRing(x, y, outer)
          const inHole = holes.some((hole) => pointInRing(x, y, hole))
          const inside = inOuter && !inHole
          let edge = Infinity
          for (const ring of rings) {
            for (let i = 0; i < ring.length; i++) {
              const a = ring[i]!
              const b = ring[(i + 1) % ring.length]!
              edge = Math.min(edge, distToSegment(x, y, a[0], a[1], b[0], b[1]))
            }
          }
          return inside ? -edge : edge
        },
      },
    }
  }
  if (kind === 'polyline' || kind === 'spline') {
    const raw = asXYList(geom.points)
    if (!raw || raw.length < 2) return { error: `${kind} requires at least two points` }
    const points = kind === 'spline' ? densifySpline(raw, Number(geom.degree) || 3) : raw
    const nearestOnPolyline = preparePolyline(points)
    return {
      query: {
        signedDistance: (x, y) => nearestOnPolyline(x, y) - half,
        hitsCell: (x0, y0, x1, y1) => polylineHitsCell(points, x0, y0, x1, y1),
      },
    }
  }
  if (kind === 'network') {
    const nodes = asXYList(geom.nodes)
    if (!nodes || nodes.length === 0) return { error: 'network has no nodes' }
    const strokes: Vec2[][] = []
    if (Array.isArray(geom.edges)) {
      for (const edge of geom.edges) {
        if (!edge || typeof edge !== 'object') continue
        const item = edge as { from?: unknown; to?: unknown; curve?: Record<string, unknown> }
        const curved = curvePoints(item.curve ?? null)
        if (curved) {
          strokes.push(curved)
          continue
        }
        const from = Number(item.from)
        const to = Number(item.to)
        const a = Number.isInteger(from) ? nodes[from] : null
        const b = Number.isInteger(to) ? nodes[to] : null
        if (a && b) strokes.push([a, b])
      }
    }
    if (strokes.length === 0) return { error: 'network has no edges' }
    const boxes = strokes.map(polylineBox)
    const nearestOnStroke = strokes.map(preparePolyline)
    return {
      query: {
        signedDistance: (x, y) => {
          // Per-cell hot path: explicit loop, no array allocation and no spread.
          // A road network spreads many short strokes over the whole plane, so most
          // of them cannot possibly be the nearest. The box test is an exact lower
          // bound on the segment distance, so culling by it changes no value.
          let nearest = Infinity
          for (let i = 0; i < strokes.length; i++) {
            if (boxDistanceExceeds(x, y, boxes[i]!, nearest)) continue
            const d = nearestOnStroke[i]!(x, y)
            if (d < nearest) nearest = d
          }
          return nearest - half
        },
        hitsCell: (x0, y0, x1, y1) => strokes.some((stroke) => polylineHitsCell(stroke, x0, y0, x1, y1)),
      },
    }
  }
  return { error: 'geometryMask requires operating Geometry (point2d / plane / polyline / spline / polygon / network)' }
}

function coverage(d: number, feather: number, crossed: boolean): number {
  if (crossed || d <= 0) return 1
  if (feather <= 0) return 0
  return clamp01(1 - d / feather)
}

export function buildGeometryMask(input: Record<string, unknown>): GeometryMaskBuild {
  const plane = asPlane(input.plane ?? input.bounds)
  const columns = Math.floor(Number(input.columns))
  const rows = Math.floor(Number(input.rows))
  const width = Number.isFinite(Number(input.width)) ? Math.max(0, Number(input.width)) : 0
  const feather = Number.isFinite(Number(input.feather)) ? Math.max(0, Number(input.feather)) : 0
  if (!plane || !(plane.width > 0) || !(plane.height > 0)) {
    return { grid: zeros(rows, columns), error: 'geometryMask requires a Geometry plane with positive width and height', _warnings: [] }
  }
  if (!(columns >= 1) || !(rows >= 1)) {
    return { grid: zeros(1, 1), error: 'geometryMask requires positive columns and rows', _warnings: [] }
  }
  const geom = unwrapGeometry(input.geometry)
  const stretch = stretchWarning(plane, columns, rows)
  const warnings = stretch ? [stretch] : []
  if (!geom) {
    return { grid: zeros(rows, columns), error: 'geometryMask requires operating Geometry', _warnings: warnings }
  }
  const frame = planeBox(plane)
  const hard = hardFromGeometry(geom, frame, width)
  if (!hard.query) {
    return { grid: zeros(rows, columns), error: hard.error, _warnings: warnings }
  }
  const cellW = plane.width / columns
  const cellH = plane.height / rows
  const thin = width <= 0 && Boolean(hard.query.hitsCell)
  const { signedDistance, hitsCell } = hard.query
  // Plain loops, not nested Array.from: a 2048-wide mask is millions of cells and
  // the callback-per-cell form spends real time in closure calls and GC.
  const grid: number[][] = new Array<number[]>(rows)
  for (let row = 0; row < rows; row++) {
    const y = frame.y0 + (row + 0.5) * cellH
    const y0 = frame.y0 + row * cellH
    const line = new Array<number>(columns)
    for (let col = 0; col < columns; col++) {
      const x = frame.x0 + (col + 0.5) * cellW
      const x0 = frame.x0 + col * cellW
      const crossed = thin ? Boolean(hitsCell?.(x0, y0, x0 + cellW, y0 + cellH)) : false
      line[col] = coverage(signedDistance(x, y), feather, crossed)
    }
    grid[row] = line
  }
  return { grid, error: hard.error, _warnings: warnings }
}
