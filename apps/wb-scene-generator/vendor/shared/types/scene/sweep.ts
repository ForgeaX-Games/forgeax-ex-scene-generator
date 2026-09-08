/**
 * Centerline sweep: a road strip from a sampled polyline, not a raster mask.
 * Z is Choice A — sample the heightfield at each XY. No 3D curve authority.
 *
 * A village road is a network of segmented curves: each edge is a dense
 * centerline, then a slightly widened ribbon draped on the attached surface.
 * Left/right Z follow the centerline so the band stays a road, not two
 * independent terrain slices that twist into shards.
 */

import type { SceneMesh } from './content.js'
import { drapeSurfaceZ, sampleHeightfieldSurface } from './heightfield.js'
import { ROAD_MESH_COLOR, ROAD_MESH_LIFT } from './stroke.js'
import { dedupeControlPoints, sampleOpenSpline, type Vec2 } from './spline.js'

export const ROAD_DECK_COLOR: readonly [number, number, number] = [0.86, 0.81, 0.72]
export const ROAD_CURB_COLOR: readonly [number, number, number] = [0.50, 0.46, 0.40]
export const ROAD_NETWORK_LIFT = 0.08
export const ROAD_SLAB_THICKNESS = 0.32

export interface SweepMeshOpts {
  readonly heightGrid?: unknown
  readonly widths?: readonly number[]
  readonly roadWidth?: number
  readonly cellSize?: number
  readonly lift?: number
  readonly color?: readonly [number, number, number]
}

function widthAt(widths: readonly number[] | undefined, roadWidth: number, i: number, n: number): number {
  if (widths && widths.length === n) return Math.max(0.4, widths[i] ?? roadWidth)
  if (widths && widths.length === 1) return Math.max(0.4, widths[0] ?? roadWidth)
  if (widths && widths.length > 1 && n > 1) {
    const t = i / (n - 1)
    const f = t * (widths.length - 1)
    const i0 = Math.min(widths.length - 2, Math.floor(f))
    const u = f - i0
    return Math.max(0.4, (widths[i0] ?? roadWidth) * (1 - u) + (widths[i0 + 1] ?? roadWidth) * u)
  }
  return Math.max(0.4, roadWidth)
}

export function buildSweepMesh(points: readonly Vec2[], opts: SweepMeshOpts = {}): SceneMesh | null {
  if (points.length < 2) return null
  const cellSize = typeof opts.cellSize === 'number' && opts.cellSize > 0 ? opts.cellSize : 1
  const lift = typeof opts.lift === 'number' && Number.isFinite(opts.lift) ? opts.lift : ROAD_MESH_LIFT
  const roadWidth = typeof opts.roadWidth === 'number' && opts.roadWidth > 0 ? opts.roadWidth : 3
  const color = opts.color ?? ROAD_MESH_COLOR
  const n = points.length

  const tangents: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const a = points[i === 0 ? 0 : i - 1]!
    const b = points[i === n - 1 ? n - 1 : i + 1]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    tangents.push([dx / len, dy / len])
  }

  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []
  const colors: number[] = []

  const left: Array<[number, number, number]> = []
  const right: Array<[number, number, number]> = []

  for (let i = 0; i < n; i++) {
    const [x, y] = points[i]!
    const [tx, ty] = tangents[i]!
    const nx = -ty
    const ny = tx
    const half = widthAt(opts.widths, roadWidth, i, n) * 0.5
    const lx = x + nx * half
    const ly = y + ny * half
    const rx = x - nx * half
    const ry = y - ny * half
    const zL = sampleHeightfieldSurface(opts.heightGrid, lx, ly) * cellSize + lift
    const zR = sampleHeightfieldSurface(opts.heightGrid, rx, ry) * cellSize + lift
    left.push([lx * cellSize, -ly * cellSize, zL])
    right.push([rx * cellSize, -ry * cellSize, zR])
  }

  for (let i = 0; i < n - 1; i++) {
    const a = left[i]!
    const b = right[i]!
    const c = right[i + 1]!
    const d = left[i + 1]!
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const nl = Math.hypot(nx, ny, nz) || 1
    nx /= nl; ny /= nl; nz /= nl
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz }

    const base = positions.length / 3
    for (const p of [a, b, c, d]) {
      positions.push(p[0], p[1], p[2])
      normals.push(nx, ny, nz)
      colors.push(color[0], color[1], color[2])
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  if (indices.length === 0) return null
  return {
    positions,
    indices,
    normals,
    colors,
    color: [1, 1, 1],
    role: 'road',
  }
}

export interface RoadNetworkEdge {
  readonly points: ReadonlyArray<readonly [number, number]>
  readonly width: number
  readonly closed?: boolean
  readonly samplesPerSegment?: number
}

export interface RoadNetworkMeshOpts {
  readonly heightGrid?: unknown
  readonly cellSize?: number
  readonly lift?: number
}

function densifyCenterline(
  raw: ReadonlyArray<readonly [number, number]>,
  samplesPerSegment: number,
  closed: boolean,
): Vec2[] {
  const pts = dedupeControlPoints(raw.map((p) => [Number(p[0]), Number(p[1])] as Vec2))
  if (pts.length < 2) return pts
  let ctrl = pts
  if (closed) {
    const a = ctrl[0]!
    const b = ctrl[ctrl.length - 1]!
    if (a[0] !== b[0] || a[1] !== b[1]) ctrl = [...ctrl, a]
  }
  if (ctrl.length === 2) {
    const a = ctrl[0]!
    const b = ctrl[1]!
    const n = Math.max(10, samplesPerSegment)
    const out: Vec2[] = []
    for (let i = 0; i <= n; i++) {
      const t = i / n
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
    return out
  }
  return sampleOpenSpline(ctrl, samplesPerSegment, 0.12, 0.88)
}

function densifyArc(points: readonly Vec2[], maxStep = 0.42): Vec2[] {
  if (points.length < 2) return points.slice()
  const out: Vec2[] = [points[0]!]
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const n = Math.max(1, Math.ceil(len / Math.max(0.2, maxStep)))
    for (let k = 1; k <= n; k++) {
      const t = k / n
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return out
}

function pushRibbonQuad(
  positions: number[],
  indices: number[],
  normals: number[],
  colors: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  d: readonly [number, number, number],
  colA: readonly [number, number, number],
  colB: readonly [number, number, number],
): void {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
  const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2]
  let nx = uy * vz - uz * vy
  let ny = uz * vx - ux * vz
  let nz = ux * vy - uy * vx
  const nl = Math.hypot(nx, ny, nz) || 1
  nx /= nl; ny /= nl; nz /= nl
  if (nz < 0) { nx = -nx; ny = -ny; nz = -nz }
  const base = positions.length / 3
  const verts = [a, b, c, d]
  const cols = [colA, colB, colB, colA]
  for (let v = 0; v < 4; v++) {
    const p = verts[v]!
    const col = cols[v]!
    positions.push(p[0], p[1], p[2])
    normals.push(nx, ny, nz)
    colors.push(col[0], col[1], col[2])
  }
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

function appendDrapedRibbon(
  points: readonly Vec2[],
  width: number,
  heightGrid: unknown,
  cellSize: number,
  lift: number,
  positions: number[],
  indices: number[],
  normals: number[],
  colors: number[],
): void {
  const center = densifyArc(points, 0.4)
  const n = center.length
  if (n < 2) return
  const half = Math.max(0.25, width * 0.5)
  const inner = half * 0.55
  const tangents: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const a = center[i === 0 ? 0 : i - 1]!
    const b = center[i === n - 1 ? n - 1 : i + 1]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    tangents.push([dx / len, dy / len])
  }

  const offsets = [-half, -inner, 0, inner, half]
  const lanes: Array<Array<[number, number, number]>> = offsets.map(() => [])
  for (let i = 0; i < n; i++) {
    const [x, y] = center[i]!
    const [tx, ty] = tangents[i]!
    const nx = -ty
    const ny = tx
    for (let k = 0; k < offsets.length; k++) {
      const ox = x + nx * offsets[k]!
      const oy = y + ny * offsets[k]!
      const curb = k === 0 || k === offsets.length - 1 ? 0.02 : 0
      const z = drapeSurfaceZ(heightGrid, ox, oy, cellSize, lift) + curb
      lanes[k]!.push([ox * cellSize, -oy * cellSize, z])
    }
  }

  const laneColors: Array<readonly [number, number, number]> = [
    ROAD_CURB_COLOR,
    ROAD_DECK_COLOR,
    ROAD_DECK_COLOR,
    ROAD_DECK_COLOR,
    ROAD_CURB_COLOR,
  ]
  for (let lane = 0; lane < offsets.length - 1; lane++) {
    const left = lanes[lane]!
    const right = lanes[lane + 1]!
    const colL = laneColors[lane]!
    const colR = laneColors[lane + 1]!
    for (let i = 0; i < n - 1; i++) {
      pushRibbonQuad(positions, indices, normals, colors, left[i]!, right[i]!, right[i + 1]!, left[i + 1]!, colL, colR)
    }
  }

  const thick = ROAD_SLAB_THICKNESS
  const drop = (p: readonly [number, number, number]): [number, number, number] => [p[0], p[1], p[2] - thick]
  const left = lanes[0]!
  const right = lanes[offsets.length - 1]!
  for (let i = 0; i < n - 1; i++) {
    const a = left[i]!, b = left[i + 1]!
    pushRibbonQuad(positions, indices, normals, colors, a, drop(a), drop(b), b, ROAD_CURB_COLOR, ROAD_CURB_COLOR)
    const c = right[i]!, d = right[i + 1]!
    pushRibbonQuad(positions, indices, normals, colors, drop(c), c, d, drop(d), ROAD_CURB_COLOR, ROAD_CURB_COLOR)
    pushRibbonQuad(positions, indices, normals, colors, drop(a), drop(c), drop(d), drop(b), ROAD_CURB_COLOR, ROAD_CURB_COLOR)
  }
}

function appendJunctionPad(
  cx: number,
  cy: number,
  radius: number,
  heightGrid: unknown,
  cellSize: number,
  lift: number,
  positions: number[],
  indices: number[],
  normals: number[],
  colors: number[],
): void {
  const segs = 16
  const zC = drapeSurfaceZ(heightGrid, cx, cy, cellSize, lift + 0.02)
  const center: [number, number, number] = [cx * cellSize, -cy * cellSize, zC]
  const ring: Array<[number, number, number]> = []
  const ringBot: Array<[number, number, number]> = []
  for (let i = 0; i < segs; i++) {
    const ang = (i / segs) * Math.PI * 2
    const x = cx + Math.cos(ang) * radius
    const y = cy + Math.sin(ang) * radius
    const zS = drapeSurfaceZ(heightGrid, x, y, cellSize, lift + 0.02)
    ring.push([x * cellSize, -y * cellSize, zS])
    ringBot.push([x * cellSize, -y * cellSize, zS - ROAD_SLAB_THICKNESS])
  }
  for (let i = 0; i < segs; i++) {
    const a = center
    const b = ring[i]!
    const c = ring[(i + 1) % segs]!
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const nl = Math.hypot(nx, ny, nz) || 1
    nx /= nl; ny /= nl; nz /= nl
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz }
    const base = positions.length / 3
    for (const p of [a, b, c]) {
      positions.push(p[0], p[1], p[2])
      normals.push(nx, ny, nz)
      colors.push(ROAD_DECK_COLOR[0], ROAD_DECK_COLOR[1], ROAD_DECK_COLOR[2])
    }
    indices.push(base, base + 1, base + 2)
    pushRibbonQuad(
      positions, indices, normals, colors,
      b, ringBot[i]!, ringBot[(i + 1) % segs]!, c,
      ROAD_CURB_COLOR, ROAD_CURB_COLOR,
    )
  }
}

/** One draped mesh for a graph of spline edges + junction pads. */
export function buildRoadNetworkMesh(
  edges: readonly RoadNetworkEdge[],
  junctions: ReadonlyArray<readonly [number, number]> = [],
  opts: RoadNetworkMeshOpts = {},
): SceneMesh | null {
  const cellSize = typeof opts.cellSize === 'number' && opts.cellSize > 0 ? opts.cellSize : 1
  const lift = typeof opts.lift === 'number' && Number.isFinite(opts.lift) ? opts.lift : ROAD_NETWORK_LIFT
  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []
  const colors: number[] = []

  for (const edge of edges) {
    const samples = Math.max(12, Math.floor(edge.samplesPerSegment ?? 16))
    const center = densifyCenterline(edge.points, samples, Boolean(edge.closed))
    appendDrapedRibbon(center, edge.width, opts.heightGrid, cellSize, lift, positions, indices, normals, colors)
  }

  const seen = new Set<string>()
  for (const j of junctions) {
    const x = Number(j[0])
    const y = Number(j[1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const key = `${x.toFixed(2)},${y.toFixed(2)}`
    if (seen.has(key)) continue
    seen.add(key)
    appendJunctionPad(x, y, 1.35, opts.heightGrid, cellSize, lift, positions, indices, normals, colors)
  }

  if (indices.length === 0) return null
  return {
    positions,
    indices,
    normals,
    colors,
    color: [1, 1, 1],
    role: 'road',
  }
}
