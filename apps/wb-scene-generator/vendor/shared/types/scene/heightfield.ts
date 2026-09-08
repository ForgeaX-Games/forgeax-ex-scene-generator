/**
 * Heightfield triangulation shared by the heightfield_mesh battery (graph value)
 * and 3DMesh's terrain builder (preview). Pure arrays — no THREE.
 *
 * World: X east, Y south flipped to -Y, Z up. One cell = cellSize metres.
 */

import type { SceneMesh } from './content.js'

export const HEIGHTFIELD_DEFAULT_COLOR: readonly [number, number, number] = [0.82, 0.82, 0.8]

const TERRAIN_GRASS: readonly [number, number, number] = [0.28, 0.58, 0.20]
const TERRAIN_FOOTHILL: readonly [number, number, number] = [0.40, 0.50, 0.26]
const TERRAIN_ROCK: readonly [number, number, number] = [0.72, 0.71, 0.68]
const TERRAIN_CLIFF: readonly [number, number, number] = [0.52, 0.51, 0.49]
const TERRAIN_SNOW: readonly [number, number, number] = [0.95, 0.96, 0.98]

function lerp3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  const u = t < 0 ? 0 : t > 1 ? 1 : t
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

/**
 * Discrete alpine bands: green valley, grey rock, white snow.
 * `t` is 0–1 over a percentile height span. `slopeDeg` only darkens rock faces —
 * it must not wash grass or snow into the same grey.
 */
export function alpineTerrainVertexColor(
  t: number,
  slopeDeg: number,
): [number, number, number] {
  const h = clamp01(t)
  const steep = slopeDeg < 28 ? 0 : Math.min(1, (slopeDeg - 28) / 22)
  if (h < 0.34) {
    const u = h / 0.34
    return lerp3(TERRAIN_GRASS, TERRAIN_FOOTHILL, u * u)
  }
  if (h < 0.52) {
    const u = (h - 0.34) / 0.18
    const base = lerp3(TERRAIN_FOOTHILL, TERRAIN_ROCK, u)
    return lerp3(base, TERRAIN_CLIFF, steep * 0.55)
  }
  if (h < 0.76) {
    return lerp3(TERRAIN_ROCK, TERRAIN_CLIFF, steep * 0.85)
  }
  const snow = h < 0.84 ? lerp3(TERRAIN_ROCK, TERRAIN_SNOW, (h - 0.76) / 0.08) : [...TERRAIN_SNOW] as [number, number, number]
  return snow
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
  return sorted[i]!
}

/** World-space squared length of the segment between two mesh verts (x,y,z). */
function segLen2(positions: number[], a: number, b: number): number {
  const ax = positions[a * 3]!
  const ay = positions[a * 3 + 1]!
  const az = positions[a * 3 + 2]!
  const dx = positions[b * 3]! - ax
  const dy = positions[b * 3 + 1]! - ay
  const dz = positions[b * 3 + 2]! - az
  return dx * dx + dy * dy + dz * dz
}

/**
 * Split a quad into two triangles using the shorter 3D diagonal.
 * Preferring the shorter diagonal keeps triangles closer to equilateral
 * (more isotropic) and reduces zigzag ridges on heightfield cliffs.
 */
export function pushIsotropicQuad(
  indices: number[],
  positions: number[],
  i00: number,
  i10: number,
  i01: number,
  i11: number,
): void {
  const dA = segLen2(positions, i00, i11)
  const dB = segLen2(positions, i10, i01)
  if (dA <= dB) {
    indices.push(i00, i10, i11)
    indices.push(i00, i11, i01)
  } else {
    indices.push(i00, i10, i01)
    indices.push(i10, i11, i01)
  }
}

export interface HeightfieldMeshOpts {
  /** Parallel occupancy mask; non-zero keeps the cell. Default: grid value !== 0. */
  readonly mask?: number[][]
  readonly cellSize?: number
  readonly color?: readonly [number, number, number]
}

function isGrid(v: unknown): v is number[][] {
  return Array.isArray(v) && v.length > 0 && Array.isArray(v[0])
}

/** Unwrap a height grid from DataTree / `{ data }` / `{ items }` wrappers. */
export function unwrapHeightGrid(value: unknown): number[][] | null {
  let cur: unknown = value
  for (let depth = 0; depth < 6; depth++) {
    if (isGrid(cur) && typeof (cur[0] as unknown[])[0] === 'number') return cur
    if (Array.isArray(cur) && cur.length > 0 && isEntryShape(cur[0])) {
      const items = (cur[0] as { items: unknown[] }).items
      cur = items.length === 1 ? items[0] : items
      continue
    }
    if (!cur || typeof cur !== 'object') return null
    const o = cur as Record<string, unknown>
    if (Array.isArray(o.entries) && o.entries.length > 0 && isEntryShape(o.entries[0])) {
      const items = (o.entries[0] as { items: unknown[] }).items
      cur = items.length === 1 ? items[0] : items
      continue
    }
    if (Array.isArray(o.items)) {
      cur = o.items.length === 1 ? o.items[0] : o.items
      continue
    }
    if (Array.isArray(o.data)) {
      cur = o.data
      continue
    }
    if (o.grid !== undefined) {
      cur = o.grid
      continue
    }
    return null
  }
  return null
}

function isEntryShape(v: unknown): boolean {
  return !!v && typeof v === 'object' && Array.isArray((v as { path?: unknown }).path) && Array.isArray((v as { items?: unknown }).items)
}

function cellOccupied(grid: number[][], mask: number[][] | undefined, x: number, y: number): boolean {
  const row = mask ? mask[y] : grid[y]
  if (!row) return false
  const raw = row[x]
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) && n !== 0
}

function cellHeight(grid: number[][], x: number, y: number): number {
  const row = grid[y]
  if (!row) return 0
  const raw = row[x]
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : 0
}

function cornerHeight(
  grid: number[][],
  mask: number[][] | undefined,
  ix: number,
  iy: number,
): number | null {
  const cells: Array<[number, number]> = [
    [ix - 1, iy - 1],
    [ix, iy - 1],
    [ix - 1, iy],
    [ix, iy],
  ]
  let sum = 0
  let n = 0
  for (const [cx, cy] of cells) {
    if (cx < 0 || cy < 0) continue
    if (!cellOccupied(grid, mask, cx, cy)) continue
    sum += cellHeight(grid, cx, cy)
    n++
  }
  return n === 0 ? null : sum / n
}

function barycentricZ(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  px: number, py: number,
): number {
  const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
  if (Math.abs(det) < 1e-12) return az
  const wB = ((px - ax) * (cy - ay) - (cx - ax) * (py - ay)) / det
  const wC = ((bx - ax) * (py - ay) - (px - ax) * (by - ay)) / det
  return (1 - wB - wC) * az + wB * bz + wC * cz
}

/**
 * Sample the same triangle surface `buildHeightfieldMesh` emits (isotropic
 * diagonal split + barycentric Z). Choice A — XY is the authority, Z follows.
 */
export function sampleHeightfieldSurface(grid: unknown, x: number, y: number): number {
  const g = unwrapHeightGrid(grid)
  if (!g) return 0
  const rows = g.length
  const cols = g.reduce((m, row) => (Array.isArray(row) && row.length > m ? row.length : m), 0)
  if (rows === 0 || cols === 0) return 0
  const maxX = cols
  const maxY = rows
  const cx = Math.max(0, Math.min(Number(x), maxX))
  const cy = Math.max(0, Math.min(Number(y), maxY))
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return 0
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(maxX, x0 + 1)
  const y1 = Math.min(maxY, y0 + 1)
  const tx = x1 === x0 ? 0 : cx - x0
  const ty = y1 === y0 ? 0 : cy - y0
  const c00 = cornerHeight(g, undefined, x0, y0) ?? 0
  const c10 = cornerHeight(g, undefined, x1, y0) ?? 0
  const c01 = cornerHeight(g, undefined, x0, y1) ?? 0
  const c11 = cornerHeight(g, undefined, x1, y1) ?? 0
  if (x1 === x0 || y1 === y0) {
    return (c00 * (1 - tx) + c10 * tx) * (1 - ty) + (c01 * (1 - tx) + c11 * tx) * ty
  }
  // Same 3D diagonal test as pushIsotropicQuad (Y-flip squares away).
  const dA = 2 + (c11 - c00) * (c11 - c00)
  const dB = 2 + (c01 - c10) * (c01 - c10)
  if (dA <= dB) {
    return tx >= ty
      ? barycentricZ(0, 0, c00, 1, 0, c10, 1, 1, c11, tx, ty)
      : barycentricZ(0, 0, c00, 1, 1, c11, 0, 1, c01, tx, ty)
  }
  return tx + ty <= 1
    ? barycentricZ(0, 0, c00, 1, 0, c10, 0, 1, c01, tx, ty)
    : barycentricZ(1, 0, c10, 1, 1, c11, 0, 1, c01, tx, ty)
}

/** Highest surface Z under a set of cell-space XY samples. */
export function sampleHeightfieldSurfaceMax(
  grid: unknown,
  points: ReadonlyArray<readonly [number, number]>,
): number {
  let max = -Infinity
  for (const [x, y] of points) {
    const h = sampleHeightfieldSurface(grid, x, y)
    if (h > max) max = h
  }
  return Number.isFinite(max) ? max : 0
}

/**
 * World-space Z for a deck that must sit on the heightfield, not cut it.
 * Exact surface sample plus a small lift that grows with local slope so
 * coarse triangles still clear convex bumps on steep ground.
 */
export function drapeSurfaceZ(
  grid: unknown,
  x: number,
  y: number,
  cellSize = 1,
  lift = 0.07,
): number {
  const z = sampleHeightfieldSurface(grid, x, y) * cellSize
  const step = 0.4
  const zx = sampleHeightfieldSurface(grid, x + step, y) * cellSize
  const zy = sampleHeightfieldSurface(grid, x, y + step) * cellSize
  const slope = Math.hypot(zx - z, zy - z) / (step * cellSize)
  return z + lift + Math.min(0.28, slope * 0.14 * cellSize)
}

/** Highest surface height in a civic disk, in grid units. */
export function civicPadHeight(grid: unknown, cx: number, cy: number, radius: number): number {
  const r = Math.max(1, radius)
  let max = -Infinity
  const step = 0.32
  for (let y = cy - r; y <= cy + r + 1e-6; y += step) {
    for (let x = cx - r; x <= cx + r + 1e-6; x += step) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) > r * r) continue
      const z = sampleHeightfieldSurface(grid, x, y)
      if (z > max) max = z
    }
  }
  return Number.isFinite(max) ? max : 0
}

/** Flatten a plaza pad so the heightfield cannot funnel through the deck. */
export function gradeCivicPad(
  grid: number[][],
  cx: number,
  cy: number,
  radius: number,
  riverMask?: number[][],
  blend = 3.6,
): number {
  // Cover the organic plaza outline plus one heightfield corner ring so
  // interpolated mesh vertices under the deck cannot sit above the pad.
  const innerR = radius * 1.22 + 1.6
  const outerR = innerR + blend
  const pad = civicPadHeight(grid, cx, cy, innerR)
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const d = Math.hypot(px - cx, py - cy)
      if (d >= outerR) continue
      // Keep the carved river bed; the plaza sits on land and must not dam the channel.
      if (riverMask?.[y]?.[x]) continue
      const w = d <= innerR ? 1 : 1 - smoothstep(innerR, outerR, d)
      grid[y]![x] = grid[y]![x]! * (1 - w) + pad * w
    }
  }
  return pad
}

/** Build a continuous hillside mesh from a height grid. Null when empty. */
export function buildHeightfieldMesh(grid: unknown, opts: HeightfieldMeshOpts = {}): SceneMesh | null {
  if (!isGrid(grid)) return null
  const rows = grid.length
  const cols = grid.reduce((m, row) => (Array.isArray(row) && row.length > m ? row.length : m), 0)
  if (rows === 0 || cols === 0) return null
  const mask = isGrid(opts.mask) ? opts.mask : undefined
  const cellSize = typeof opts.cellSize === 'number' && Number.isFinite(opts.cellSize) && opts.cellSize > 0
    ? opts.cellSize
    : 1
  const color = opts.color ?? HEIGHTFIELD_DEFAULT_COLOR

  const vertsX = cols + 1
  const vertsY = rows + 1
  const cornerH: Array<number | null> = new Array(vertsX * vertsY)
  for (let j = 0; j < vertsY; j++) {
    for (let i = 0; i < vertsX; i++) {
      cornerH[j * vertsX + i] = cornerHeight(grid, mask, i, j)
    }
  }

  const positions: number[] = []
  const indices: number[] = []
  const vertIndex = new Map<number, number>()

  const ensureVert = (i: number, j: number): number | null => {
    const linear = j * vertsX + i
    const cached = vertIndex.get(linear)
    if (cached !== undefined) return cached
    const h = cornerH[linear]
    if (h === null || h === undefined) return null
    const meshIdx = positions.length / 3
    positions.push(i * cellSize, -j * cellSize, h * cellSize)
    vertIndex.set(linear, meshIdx)
    return meshIdx
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!cellOccupied(grid, mask, x, y)) continue
      const i00 = ensureVert(x, y)
      const i10 = ensureVert(x + 1, y)
      const i01 = ensureVert(x, y + 1)
      const i11 = ensureVert(x + 1, y + 1)
      if (i00 === null || i10 === null || i01 === null || i11 === null) continue
      pushIsotropicQuad(indices, positions, i00, i10, i01, i11)
    }
  }

  if (indices.length === 0) return null

  const colors: number[] = new Array(positions.length)
  const paintedUniform = opts.color !== undefined
  const heights: number[] = []
  if (!paintedUniform) {
    for (const h of cornerH) {
      if (h === null || h === undefined) continue
      heights.push(h)
    }
    heights.sort((a, b) => a - b)
  }
  const loH = paintedUniform ? 0 : percentile(heights, 0.08)
  const hiH = paintedUniform ? 1 : Math.max(loH + 1e-4, percentile(heights, 0.88))
  const spanH = hiH - loH
  const meshToCorner = new Map<number, number>()
  for (const [linear, meshIdx] of vertIndex) meshToCorner.set(meshIdx, linear)
  const vertCount = positions.length / 3
  for (let meshIdx = 0; meshIdx < vertCount; meshIdx++) {
    if (paintedUniform) {
      colors[meshIdx * 3] = color[0]
      colors[meshIdx * 3 + 1] = color[1]
      colors[meshIdx * 3 + 2] = color[2]
      continue
    }
    const linear = meshToCorner.get(meshIdx) ?? 0
    const i = linear % vertsX
    const j = Math.floor(linear / vertsX)
    const h = cornerH[linear] ?? loH
    const hL = cornerH[j * vertsX + Math.max(0, i - 1)]
    const hR = cornerH[j * vertsX + Math.min(vertsX - 1, i + 1)]
    const hU = cornerH[Math.max(0, j - 1) * vertsX + i]
    const hD = cornerH[Math.min(vertsY - 1, j + 1) * vertsX + i]
    const dx = ((hR ?? h) - (hL ?? h)) / (i === 0 || i === vertsX - 1 ? 1 : 2)
    const dy = ((hD ?? h) - (hU ?? h)) / (j === 0 || j === vertsY - 1 ? 1 : 2)
    const slopeDeg = Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI
    const rgb = alpineTerrainVertexColor((h - loH) / spanH, slopeDeg)
    colors[meshIdx * 3] = rgb[0]
    colors[meshIdx * 3 + 1] = rgb[1]
    colors[meshIdx * 3 + 2] = rgb[2]
  }

  return {
    positions,
    indices,
    colors,
    color: paintedUniform ? [color[0], color[1], color[2]] : [1, 1, 1],
    role: 'terrain',
  }
}

export interface SemanticMountainPeak {
  readonly x: number
  readonly y: number
  readonly elevation?: number
  readonly radius?: number
  readonly sharpness?: number
  readonly type?: 'alpine_peak' | 'ridge_point' | 'foothill' | 'basin' | 'saddle'
}

export interface AlpineValleyTerrainOpts {
  readonly width?: number
  readonly height?: number
  readonly valleyDepth?: number
  readonly valleyWidth?: number
  readonly riverDepth?: number
  readonly riverWidth?: number
  readonly ridgeNoise?: number
  readonly seed?: number
  readonly baseElevation?: number
  readonly peaks?: readonly (SemanticMountainPeak | [number, number] | { x: number; y: number; [key: string]: unknown })[]
  readonly riverPoints?: unknown
  readonly erosionStrength?: number
  readonly terraceSteps?: number
  readonly plazaCenter?: unknown
  readonly plazaRadius?: number
}

export interface AlpineValleyTerrainResult {
  readonly heightGrid: number[][]
  readonly valleyMask: number[][]
  readonly riverMask: number[][]
  readonly terraceMask: number[][]
  readonly cliffMask: number[][]
  readonly forestMask: number[][]
  readonly buildableMask: number[][]
  readonly slopeGrid: number[][]
  readonly minElevation: number
  readonly maxElevation: number
}

interface PeakInternal {
  x: number
  y: number
  amp: number
  sigma: number
  sharpness: number
  type: string
}

interface RidgeInternal {
  ax: number
  ay: number
  bx: number
  by: number
  amp: number
  width: number
  sharpness: number
}

function distToSeg(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): { dist: number; t: number } {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  if (l2 < 1e-8) return { dist: Math.hypot(px - ax, py - ay), t: 0 }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
  return { dist: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t }
}

function parsePoint2(raw: unknown): [number, number] | null {
  if (!raw) return null
  let cur: unknown = raw
  if (cur && typeof cur === 'object' && 'items' in cur) cur = (cur as { items: unknown }).items
  if (Array.isArray(cur) && cur.length >= 2 && typeof cur[0] === 'number' && typeof cur[1] === 'number') {
    const x = Number(cur[0]), y = Number(cur[1])
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
  }
  if (Array.isArray(cur) && cur.length > 0) {
    const p = cur[0]
    if (Array.isArray(p) && p.length >= 2) return [Number(p[0]), Number(p[1])]
    if (p && typeof p === 'object' && 'x' in p && 'y' in p) {
      return [Number((p as { x: unknown }).x), Number((p as { y: unknown }).y)]
    }
  }
  if (cur && typeof cur === 'object' && !Array.isArray(cur) && 'x' in cur && 'y' in cur) {
    const x = Number((cur as { x: unknown }).x)
    const y = Number((cur as { y: unknown }).y)
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
  }
  return null
}

function parseRiverPolyline(raw: unknown): Array<[number, number]> {
  if (!raw) return []
  let cur: unknown = raw
  if (cur && typeof cur === 'object' && 'items' in cur) cur = (cur as { items: unknown }).items
  if (!Array.isArray(cur)) return []
  if (cur.length >= 2 && typeof cur[0] === 'number' && typeof cur[1] === 'number') {
    return [[Number(cur[0]), Number(cur[1])]]
  }
  const out: Array<[number, number]> = []
  for (const p of cur) {
    if (Array.isArray(p) && p.length >= 2) out.push([Number(p[0]), Number(p[1])])
    else if (p && typeof p === 'object' && 'x' in p && 'y' in p) {
      out.push([Number((p as { x: unknown }).x), Number((p as { y: unknown }).y)])
    }
  }
  return out.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
}

function distToPolyline(px: number, py: number, pts: ReadonlyArray<readonly [number, number]>): number {
  if (pts.length === 0) return Infinity
  if (pts.length === 1) return Math.hypot(px - pts[0]![0], py - pts[0]![1])
  let best = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSeg(px, py, pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1]).dist
    if (d < best) best = d
  }
  return best
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function ridgedFbm(x: number, y: number, octaves: number, freq: number, gain: number, lac: number): number {
  let sum = 0
  let amp = 1
  let f = freq
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(Math.sin(x * f + i * 1.7) * Math.cos(y * f * 0.83 - i * 0.9))
    sum += n * n * amp
    norm += amp
    amp *= gain
    f *= lac
  }
  return norm > 0 ? sum / norm : 0
}

function peakContribution(x: number, y: number, p: PeakInternal): number {
  const normDist = Math.hypot(x - p.x, y - p.y) / Math.max(0.15, p.sigma)
  if (normDist >= 3.4) return 0
  const sign = p.type === 'basin' || p.type === 'saddle' ? -1 : 1
  return sign * p.amp * Math.exp(-Math.pow(normDist, p.sharpness))
}

function ridgeContribution(x: number, y: number, r: RidgeInternal): number {
  const { dist, t } = distToSeg(x, y, r.ax, r.ay, r.bx, r.by)
  const norm = dist / Math.max(0.15, r.width)
  if (norm >= 3.2) return 0
  const saddle = 1 - 0.24 * Math.sin(t * Math.PI)
  return r.amp * saddle * Math.exp(-Math.pow(norm, r.sharpness))
}

export function generateAlpineValleyTerrain(opts: AlpineValleyTerrainOpts = {}): AlpineValleyTerrainResult {
  const W = Math.max(16, Math.floor(opts.width ?? 128))
  const H = Math.max(16, Math.floor(opts.height ?? 128))
  const depth = Number(opts.valleyDepth ?? 42)
  const vWidth = Number(opts.valleyWidth ?? 32)
  const riverDepth = Number(opts.riverDepth ?? 2.2)
  const riverWidth = Number(opts.riverWidth ?? 8)
  const ridgeNoise = Number(opts.ridgeNoise ?? 4.6)
  const seed = Number(opts.seed ?? 27)
  const base = Number(opts.baseElevation ?? 3)
  const erosion = Number(opts.erosionStrength ?? 0.7)
  const terraceSteps = Math.max(1, Math.floor(opts.terraceSteps ?? 6))
  const worldScale = Math.min(W, H) / 64
  const riverPoly = parseRiverPolyline(opts.riverPoints)

  const sineRiverYAt = (x: number): number => {
    const u = x / W
    return H * 0.40 + Math.sin(u * Math.PI * 1.85 + 0.45) * (H * 0.06)
      + Math.sin(u * Math.PI * 4.1) * (H * 0.012)
  }
  const riverYAt = (x: number): number => {
    if (riverPoly.length < 2) return sineRiverYAt(x)
    let best = riverPoly[0]![1]
    let bestD = Infinity
    for (let i = 0; i < riverPoly.length - 1; i++) {
      const ax = riverPoly[i]![0], ay = riverPoly[i]![1]
      const bx = riverPoly[i + 1]![0], by = riverPoly[i + 1]![1]
      const dx = bx - ax
      const l2 = dx * dx + (by - ay) * (by - ay)
      const t = l2 < 1e-8 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx) / l2))
      const qx = ax + t * dx
      const qy = ay + t * (by - ay)
      const d = Math.abs(qx - x)
      if (d < bestD) {
        bestD = d
        best = qy
      }
    }
    return best
  }
  const distFromRiverAt = (x: number, y: number): number => (
    riverPoly.length >= 2
      ? distToPolyline(x + 0.5, y + 0.5, riverPoly)
      : Math.abs(y - sineRiverYAt(x))
  )

  let s = (Math.abs(Math.floor(seed)) * 16807 + 1) % 2147483647
  function rand(): number {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }

  const parsedPeaks: PeakInternal[] = []
  if (Array.isArray(opts.peaks) && opts.peaks.length > 0) {
    for (const raw of opts.peaks) {
      if (Array.isArray(raw) && raw.length >= 2) {
        parsedPeaks.push({
          x: Number(raw[0]),
          y: Number(raw[1]),
          amp: depth * 1.15,
          sigma: 9 * worldScale,
          sharpness: 1.9,
          type: 'alpine_peak',
        })
      } else if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>
        const hasRadius = obj.radius !== undefined || obj.sigma !== undefined
        parsedPeaks.push({
          x: Number(obj.x ?? 0),
          y: Number(obj.y ?? 0),
          amp: Number(obj.elevation ?? obj.amp ?? depth * 1.15),
          sigma: Number(obj.radius ?? obj.sigma ?? 9 * worldScale) * (hasRadius ? 1 : 1),
          sharpness: Number(obj.sharpness ?? 1.9),
          type: String(obj.type ?? 'alpine_peak'),
        })
      }
    }
  }

  const peaks: PeakInternal[] = [...parsedPeaks]

  const pushPeak = (p: PeakInternal, minDist: number): void => {
    for (const e of peaks) {
      if (Math.hypot(e.x - p.x, e.y - p.y) < minDist) return
    }
    peaks.push(p)
  }

  // User summits stay authoritative. Always grow a full alpine orography around them
  // so a handful of guide points cannot collapse the range into a single wall.
  pushPeak({ x: W * 0.12 + rand() * W * 0.03, y: H * 0.06 + rand() * H * 0.02, amp: depth * 1.20, sigma: 10 * worldScale, sharpness: 2.15, type: 'alpine_peak' }, 10 * worldScale)
  pushPeak({ x: W * 0.30 + rand() * W * 0.03, y: H * 0.04 + rand() * H * 0.02, amp: depth * 1.48, sigma: 12 * worldScale, sharpness: 2.35, type: 'alpine_peak' }, 10 * worldScale)
  pushPeak({ x: W * 0.50 + rand() * W * 0.03, y: H * 0.05 + rand() * H * 0.02, amp: depth * 1.62, sigma: 13 * worldScale, sharpness: 2.40, type: 'alpine_peak' }, 10 * worldScale)
  pushPeak({ x: W * 0.70 + rand() * W * 0.03, y: H * 0.06 + rand() * H * 0.02, amp: depth * 1.38, sigma: 11 * worldScale, sharpness: 2.20, type: 'alpine_peak' }, 10 * worldScale)
  pushPeak({ x: W * 0.88 + rand() * W * 0.03, y: H * 0.09 + rand() * H * 0.02, amp: depth * 1.18, sigma: 10 * worldScale, sharpness: 2.05, type: 'alpine_peak' }, 10 * worldScale)

  pushPeak({ x: W * 0.20, y: H * 0.20, amp: depth * 0.72, sigma: 8 * worldScale, sharpness: 1.55, type: 'ridge_point' }, 8 * worldScale)
  pushPeak({ x: W * 0.42, y: H * 0.17, amp: depth * 0.68, sigma: 8 * worldScale, sharpness: 1.50, type: 'ridge_point' }, 8 * worldScale)
  pushPeak({ x: W * 0.66, y: H * 0.19, amp: depth * 0.78, sigma: 9 * worldScale, sharpness: 1.60, type: 'ridge_point' }, 8 * worldScale)
  pushPeak({ x: W * 0.84, y: H * 0.22, amp: depth * 0.64, sigma: 8 * worldScale, sharpness: 1.50, type: 'foothill' }, 8 * worldScale)

  pushPeak({ x: W * 0.05, y: H * 0.30, amp: depth * 0.95, sigma: 9 * worldScale, sharpness: 1.85, type: 'alpine_peak' }, 9 * worldScale)
  pushPeak({ x: W * 0.07, y: H * 0.48, amp: depth * 0.62, sigma: 8 * worldScale, sharpness: 1.55, type: 'ridge_point' }, 8 * worldScale)
  pushPeak({ x: W * 0.09, y: H * 0.70, amp: depth * 0.40, sigma: 9 * worldScale, sharpness: 1.35, type: 'foothill' }, 8 * worldScale)

  pushPeak({ x: W * 0.94, y: H * 0.26, amp: depth * 1.05, sigma: 10 * worldScale, sharpness: 1.90, type: 'alpine_peak' }, 9 * worldScale)
  pushPeak({ x: W * 0.90, y: H * 0.46, amp: depth * 0.58, sigma: 8 * worldScale, sharpness: 1.50, type: 'ridge_point' }, 8 * worldScale)
  pushPeak({ x: W * 0.93, y: H * 0.74, amp: depth * 0.46, sigma: 9 * worldScale, sharpness: 1.35, type: 'foothill' }, 8 * worldScale)

  pushPeak({ x: W * 0.22, y: H * 0.88, amp: depth * 0.36, sigma: 12 * worldScale, sharpness: 1.25, type: 'foothill' }, 10 * worldScale)
  pushPeak({ x: W * 0.48, y: H * 0.92, amp: depth * 0.44, sigma: 13 * worldScale, sharpness: 1.28, type: 'foothill' }, 10 * worldScale)
  pushPeak({ x: W * 0.74, y: H * 0.86, amp: depth * 0.50, sigma: 12 * worldScale, sharpness: 1.32, type: 'foothill' }, 10 * worldScale)

  pushPeak({ x: W * 0.54, y: H * 0.50, amp: depth * 0.16, sigma: 14 * worldScale, sharpness: 1.15, type: 'basin' }, 12 * worldScale)
  pushPeak({ x: W * 0.76, y: H * 0.62, amp: depth * 0.12, sigma: 11 * worldScale, sharpness: 1.10, type: 'basin' }, 12 * worldScale)

  const alpineCrest = peaks
    .filter((p) => p.type === 'alpine_peak' && p.y < H * 0.28)
    .sort((a, b) => a.x - b.x)

  const ridges: RidgeInternal[] = []
  for (let i = 0; i < alpineCrest.length - 1; i++) {
    const a = alpineCrest[i]!
    const b = alpineCrest[i + 1]!
    ridges.push({
      ax: a.x, ay: a.y, bx: b.x, by: b.y,
      amp: Math.min(a.amp, b.amp) * 0.62,
      width: 5.5 * worldScale,
      sharpness: 1.7,
    })
  }

  const midSpurs = peaks.filter((p) => p.type === 'ridge_point' || p.type === 'foothill')
  for (const spur of midSpurs) {
    let nearest: PeakInternal | null = null
    let best = Infinity
    for (const crest of alpineCrest) {
      const d = Math.hypot(crest.x - spur.x, crest.y - spur.y)
      if (d < best) { best = d; nearest = crest }
    }
    if (nearest && best < 0.45 * Math.min(W, H)) {
      ridges.push({
        ax: nearest.x, ay: nearest.y, bx: spur.x, by: spur.y,
        amp: Math.min(nearest.amp, spur.amp) * 0.48,
        width: 4.2 * worldScale,
        sharpness: 1.55,
      })
    }
  }

  // West and east flanking ranges as continuous walls, not isolated cones.
  ridges.push({
    ax: W * 0.04, ay: H * 0.12, bx: W * 0.08, by: H * 0.72,
    amp: depth * 0.55, width: 6.5 * worldScale, sharpness: 1.45,
  })
  ridges.push({
    ax: W * 0.96, ay: H * 0.10, bx: W * 0.92, by: H * 0.78,
    amp: depth * 0.58, width: 6.8 * worldScale, sharpness: 1.45,
  })

  const heightGrid: number[][] = Array.from({ length: H }, () => new Array(W).fill(0))
  const valleyMask: number[][] = Array.from({ length: H }, () => new Array(W).fill(0))
  const riverMask: number[][] = Array.from({ length: H }, () => new Array(W).fill(0))
  const terraceMask: number[][] = Array.from({ length: H }, () => new Array(W).fill(0))
  const cliffMask: number[][] = Array.from({ length: H }, () => new Array(W).fill(0))
  const forestMask: number[][] = Array.from({ length: H }, () => new Array(W).fill(0))
  const buildableMask: number[][] = Array.from({ length: H }, () => new Array(W).fill(0))
  const slopeGrid: number[][] = Array.from({ length: H }, () => new Array(W).fill(0))

  const sideAx = W * 0.58
  const sideAy = H * 0.46
  const sideBx = W * 0.90
  const sideBy = H * 0.80
  const sideHalf = Math.max(5, vWidth * 0.28)

  let minZ = Infinity
  let maxZ = -Infinity

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W
      const meander =
        Math.sin(u * Math.PI * 1.55 + (seed % 7) * 0.4) * (H * 0.055) +
        Math.sin(u * Math.PI * 3.2 + 1.1) * (H * 0.018)
      const valleyCenterY = riverPoly.length >= 2 ? riverYAt(x) : H * 0.44 + meander
      const flare = 0.58 + 0.62 * smoothstep(0.12, 0.88, u)
      const halfV = (vWidth * 0.5) * flare
      const distFromRiver = distFromRiverAt(x, y)
      const distFromValley = riverPoly.length >= 2 ? distFromRiver : Math.abs(y - valleyCenterY)
      const halfR = riverWidth * 0.5

      let hValley: number
      let slopeFactor: number
      if (distFromValley < halfV) {
        const t = distFromValley / halfV
        hValley = base + t * t * 1.8 * worldScale
        slopeFactor = t * 0.18
      } else {
        const isNorth = y < valleyCenterY
        const maxDist = isNorth ? valleyCenterY : (H - valleyCenterY)
        const t = Math.min(1, (distFromValley - halfV) / Math.max(1, maxDist - halfV))
        const shoulder = isNorth
          ? Math.pow(t, 0.72)
          : t * t * (3 - 2 * t)
        const flankAmp = isNorth ? depth * 0.28 : depth * 0.22
        hValley = base + 1.8 * worldScale + flankAmp * shoulder
        slopeFactor = shoulder * (isNorth ? 1.0 : 0.48)
      }

      // Hanging southeast side-valley: a second trough that breaks the single-U silhouette.
      const side = distToSeg(x, y, sideAx, sideAy, sideBx, sideBy)
      if (side.dist < sideHalf * 2.2) {
        const st = Math.min(1, side.dist / sideHalf)
        const carve = (1 - st * st) * depth * 0.22 * (0.35 + 0.65 * side.t)
        hValley -= carve
        slopeFactor = Math.min(1, slopeFactor + (1 - st) * 0.25)
      }

      let hRiverCarve = 0
      if (distFromRiver < halfR) {
        const rt = distFromRiver / halfR
        hRiverCarve = -riverDepth * (1 - rt * rt)
        riverMask[y]![x] = 1
      }
      if (side.dist < sideHalf * 0.38 && side.t > 0.15) {
        const rt = side.dist / Math.max(0.2, sideHalf * 0.38)
        hRiverCarve = Math.min(hRiverCarve, -riverDepth * 0.55 * (1 - rt * rt))
        riverMask[y]![x] = 1
      }

      let hPeakMax = 0
      let hRidgeMax = 0
      let hBasin = 0
      for (const p of peaks) {
        const c = peakContribution(x, y, p)
        if (p.type === 'basin' || p.type === 'saddle') hBasin += c
        else if (c > hPeakMax) hPeakMax = c
      }
      for (const r of ridges) {
        const c = ridgeContribution(x, y, r)
        if (c > hRidgeMax) hRidgeMax = c
      }
      const hOrography = Math.max(hPeakMax, hRidgeMax * 0.88) + hBasin

      const isNorth = y < valleyCenterY
      const warpX = x + 4.2 * worldScale * Math.sin(y * 0.045 + seed * 0.31)
      const warpY = y + 4.2 * worldScale * Math.cos(x * 0.04 - seed * 0.27)
      const nx = warpX * (0.14 / worldScale) + seed * 0.37
      const ny = warpY * (0.14 / worldScale) + seed * 0.29
      const ridged = ridgedFbm(nx, ny, 5, 0.55, 0.48, 2.05)
      const gully = Math.pow(Math.abs(Math.sin(nx * 0.85 + ny * 1.15)), 5) * erosion * -1.35
      const scree = Math.sin(nx * 3.4 - ny * 2.8) * 0.16
      const noiseAmp = (isNorth ? ridgeNoise : ridgeNoise * 0.46) * worldScale
      const hNoise = (ridged * 1.15 + gully + scree) * noiseAmp * Math.max(0.12, slopeFactor)

      let totalZ = hValley + hOrography * (0.22 + 0.78 * slopeFactor) + hNoise + hRiverCarve

      const terraceCeil = base + Math.max(6, 5.5 * worldScale + terraceSteps * 1.15)
      const isSouthFlank = y > valleyCenterY + 2 && y < valleyCenterY + vWidth * 1.45
      const isEastBench = x > W * 0.52 && y > valleyCenterY && y < valleyCenterY + vWidth * 1.7
      if ((isSouthFlank || isEastBench) && totalZ >= base + 0.8 && totalZ <= terraceCeil && distFromRiver > halfR + 2.8) {
        const stepH = Math.max(1.15, (terraceCeil - base) / Math.max(2, terraceSteps))
        const normZ = (totalZ - base) / stepH
        const stepIdx = Math.floor(normZ)
        const frac = normZ - stepIdx
        const steppedFrac = frac < 0.72 ? frac * 0.08 : 0.058 + (frac - 0.72) / 0.28 * 0.942
        totalZ = totalZ * 0.18 + (base + (stepIdx + steppedFrac) * stepH) * 0.82
        terraceMask[y]![x] = 1
      }

      heightGrid[y]![x] = Math.max(0.4, totalZ)
    }
  }

  // Thermal erosion: steep cells shed mass downhill, carving gullies and breaking slab walls.
  const talus = 0.62 * worldScale
  const rate = 0.22 * Math.max(0.15, Math.min(1.2, erosion))
  const passes = W >= 96 ? 3 : 2
  for (let iter = 0; iter < passes; iter++) {
    const next: number[][] = heightGrid.map((row) => row.slice())
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const z = heightGrid[y]![x]!
        let bestDx = 0
        let bestDy = 0
        let bestDrop = 0
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue
            const drop = z - heightGrid[y + oy]![x + ox]!
            const step = ox !== 0 && oy !== 0 ? Math.SQRT2 : 1
            const grade = drop / step
            if (grade > bestDrop) {
              bestDrop = grade
              bestDx = ox
              bestDy = oy
            }
          }
        }
        if (bestDrop > talus) {
          const move = (bestDrop - talus) * rate
          next[y]![x] = z - move
          next[y + bestDy]![x + bestDx]! += move * 0.82
        }
      }
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) heightGrid[y]![x] = next[y]![x]!
    }
  }

  // Re-cut the river after thermal erosion so the water mesh and the gully share one bed.
  const halfR = riverWidth * 0.5
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dist = distFromRiverAt(x, y)
      if (dist >= halfR) continue
      const rt = dist / halfR
      const bed = base + 0.12 - riverDepth * (1 - rt * rt)
      heightGrid[y]![x] = Math.min(heightGrid[y]![x]!, bed)
      riverMask[y]![x] = 1
    }
  }

  const plaza = parsePoint2(opts.plazaCenter)
  if (plaza) {
    gradeCivicPad(heightGrid, plaza[0], plaza[1], Number(opts.plazaRadius ?? 7.4), riverMask)
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const roundedZ = Math.round(heightGrid[y]![x]! * 100) / 100
      heightGrid[y]![x] = roundedZ
      if (roundedZ < minZ) minZ = roundedZ
      if (roundedZ > maxZ) maxZ = roundedZ

      const u = x / W
      const meander =
        Math.sin(u * Math.PI * 1.55 + (seed % 7) * 0.4) * (H * 0.055) +
        Math.sin(u * Math.PI * 3.2 + 1.1) * (H * 0.018)
      const valleyCenterY = riverPoly.length >= 2 ? riverYAt(x) : H * 0.44 + meander
      const flare = 0.58 + 0.62 * smoothstep(0.12, 0.88, u)
      const halfV = (vWidth * 0.5) * flare
      const distFromRiver = distFromRiverAt(x, y)
      const distFromValley = riverPoly.length >= 2 ? distFromRiver : Math.abs(y - valleyCenterY)

      const zL = heightGrid[y]![Math.max(0, x - 1)]!
      const zR = heightGrid[y]![Math.min(W - 1, x + 1)]!
      const zD = heightGrid[Math.max(0, y - 1)]![x]!
      const zU = heightGrid[Math.min(H - 1, y + 1)]![x]!
      const dx = (zR - zL) / (x === 0 || x === W - 1 ? 1 : 2)
      const dy = (zU - zD) / (y === 0 || y === H - 1 ? 1 : 2)
      const slopeDeg = Math.round((Math.atan(Math.hypot(dx, dy)) * 180 / Math.PI) * 10) / 10
      slopeGrid[y]![x] = slopeDeg

      if (distFromValley <= halfV + 4.5 * worldScale && distFromRiver >= halfR + 1.4 && slopeDeg < 18) {
        valleyMask[y]![x] = 1
      }
      if (slopeDeg > 28 || roundedZ > base + depth * 0.72) {
        cliffMask[y]![x] = 1
      }
      if (slopeDeg >= 7 && slopeDeg <= 28 && distFromRiver > halfR + 3 && cliffMask[y]![x] === 0) {
        forestMask[y]![x] = 1
      }
      if (distFromRiver >= halfR + 1.6 && slopeDeg <= 22 && roundedZ >= base + 0.3 && roundedZ <= base + depth * 0.62) {
        buildableMask[y]![x] = 1
      }
    }
  }

  return {
    heightGrid,
    valleyMask,
    riverMask,
    terraceMask,
    cliffMask,
    forestMask,
    buildableMask,
    slopeGrid,
    minElevation: minZ,
    maxElevation: maxZ,
  }
}

