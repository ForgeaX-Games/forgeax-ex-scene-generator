import { isNumericBuffer } from '@forgeax/scene-authoring/scene-tree'
/**
 * Minkowski band of a 3D wireframe on a hangable mesh.
 * Vertices are offset samples of the skeleton (stadium strips + node disks),
 * then sat on the mesh. The output triangulation is that parametric grid —
 * not a clip of the input mesh triangles.
 * Plan: XY capsules, vertical sit, +Z offset.
 * Geodesic: tangent-plane offset, closest-point sit, normal offset.
 * Width is a consumption argument, not a Geometry field.
 */

const EPS = 1e-9
const SIT_M = 2.5
const SKELETON_KINDS = new Set(['point3d', 'polyline3d', 'spline3d', 'network3d'])

type Vec3 = [number, number, number]

export type SurfaceBandMetric = 'geodesic' | 'plan'

export interface SurfaceBandSample {
  readonly p: Vec3
  readonly r: number
}

interface MeshView {
  positions: number[]
  indices: number[]
  uvs?: number[]
}

interface Sample {
  p: Vec3
  r: number
}

interface Strand {
  points: Vec3[]
  radii: number[]
}

interface Skeleton {
  hubs: Sample[]
  strands: Strand[]
}

interface Hit {
  p: Vec3
  n: Vec3
  uv?: [number, number]
}

function peel(value: unknown, depth = 0): Record<string, unknown> | null {
  if (value == null || depth > 8 || typeof value !== 'object') return null
  const rec = value as { kind?: unknown; geometry?: unknown; mesh?: unknown }
  if (typeof rec.kind === 'string') return rec as Record<string, unknown>
  if (rec.geometry !== undefined) return peel(rec.geometry, depth + 1)
  if (rec.mesh !== undefined) return peel(rec.mesh, depth + 1)
  return rec as Record<string, unknown>
}

function finite(n: unknown, fallback = 0): number {
  const v = Number(n)
  return Number.isFinite(v) ? v : fallback
}

function asPoint(value: unknown): Vec3 | null {
  if (Array.isArray(value) && value.length >= 3) {
    const x = finite(value[0])
    const y = finite(value[1])
    const z = finite(value[2])
    return [x, y, z]
  }
  if (value && typeof value === 'object') {
    const rec = value as { x?: unknown; y?: unknown; z?: unknown; kind?: unknown }
    if (rec.kind === 'point2d' || rec.z === undefined) return null
    if (rec.x !== undefined && rec.y !== undefined && rec.z !== undefined) {
      return [finite(rec.x), finite(rec.y), finite(rec.z)]
    }
  }
  return null
}

function asNumberList(value: unknown): number[] | null {
  if (value == null) return null
  if (!Array.isArray(value)) {
    const n = Number(value)
    return Number.isFinite(n) ? [n] : null
  }
  const out: number[] = []
  for (const item of value) {
    if (item && typeof item === 'object' && 'value' in item) {
      out.push(finite((item as { value: unknown }).value))
      continue
    }
    const n = Number(item)
    if (!Number.isFinite(n)) return null
    out.push(n)
  }
  return out
}

function readMesh(raw: unknown): MeshView | { error: string } {
  const rec = peel(raw)
  if (!rec || rec.kind !== 'mesh') return { error: 'surfaceBand requires hangable Geometry kind mesh' }
  const positions = rec.positions
  const indices = rec.indices
  if (!isNumericBuffer(positions) || positions.length < 9 || !isNumericBuffer(indices) || indices.length < 3) {
    return { error: 'surfaceBand mesh needs positions and triangle indices' }
  }
  const uvs = Array.isArray(rec.uvs) ? rec.uvs as number[] : undefined
  return {
    positions: positions as number[],
    indices: indices as number[],
    ...(uvs && uvs.length >= 2 ? { uvs } : {}),
  }
}

function vert(positions: number[], i: number): Vec3 {
  const o = i * 3
  return [positions[o] ?? 0, positions[o + 1] ?? 0, positions[o + 2] ?? 0]
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function len(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2])
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function distXY(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function normalize(a: Vec3): Vec3 {
  const n = len(a)
  if (n < EPS) return [0, 0, 1]
  return scale(a, 1 / n)
}

function xyPerp(T: Vec3): Vec3 {
  const L = Math.hypot(T[0], T[1])
  if (L < EPS) return [1, 0, 0]
  return [-T[1] / L, T[0] / L, 0]
}

function binormal(T: Vec3, N: Vec3): Vec3 {
  const B = cross(T, N)
  const L = len(B)
  if (L < EPS) return xyPerp(T)
  return scale(B, 1 / L)
}

function tangentBasis(N: Vec3): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(N[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const ax = normalize(cross(ref, N))
  const ay = normalize(cross(N, ax))
  return [ax, ay]
}

function densifyWithR(
  points: readonly Vec3[],
  radii: readonly number[],
  spacing: number,
  metric: SurfaceBandMetric,
): Sample[] {
  if (points.length === 0) return []
  const step = spacing > EPS ? spacing : 1
  const out: Sample[] = [{ p: points[0]!, r: radii[0] ?? radii[radii.length - 1] ?? 0 }]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    const ra = radii[Math.min(i - 1, radii.length - 1)] ?? out[out.length - 1]!.r
    const rb = radii[Math.min(i, radii.length - 1)] ?? ra
    const span = metric === 'plan' ? distXY(a, b) : dist(a, b)
    const n = Math.max(1, Math.ceil(span / step))
    for (let k = 1; k <= n; k++) {
      const t = k / n
      out.push({ p: lerp(a, b, t), r: ra + (rb - ra) * t })
    }
  }
  return out
}

function curvePoints(curve: unknown): Vec3[] {
  if (!curve || typeof curve !== 'object') return []
  const rec = curve as { points?: unknown }
  if (!Array.isArray(rec.points)) return []
  const pts: Vec3[] = []
  for (const item of rec.points) {
    const p = asPoint(item)
    if (p) pts.push(p)
  }
  return pts
}

function skeletonFromGeometry(
  rec: Record<string, unknown>,
  width: number,
  widths: number[] | null,
): Skeleton | { error: string } {
  const kind = String(rec.kind)
  if (!SKELETON_KINDS.has(kind)) {
    if (kind === 'polygon3d' || kind === 'polygon') {
      return { error: 'surfaceBand takes a skeleton (point3d / polyline3d / spline3d / network3d), not a polygon' }
    }
    return { error: `surfaceBand cannot consume Geometry kind ${kind}; lift 2D Geometry with liftToSurface first` }
  }
  const half = width / 2
  const hubs: Sample[] = []
  const strands: Strand[] = []

  if (kind === 'point3d') {
    const p = asPoint(rec) ?? asPoint([rec.x, rec.y, rec.z])
    if (!p) return { error: 'surfaceBand point3d needs x, y, z' }
    const r = widths && widths.length === 1 ? widths[0]! / 2 : half
    if (r <= 0) return { error: 'SCENE_GEOMETRY_DEGENERATE: surfaceBand width must be > 0' }
    hubs.push({ p, r })
    return { hubs, strands }
  }

  if (kind === 'polyline3d' || kind === 'spline3d') {
    const raw = Array.isArray(rec.points) ? rec.points : []
    const pts: Vec3[] = []
    for (const item of raw) {
      const p = asPoint(item)
      if (!p) return { error: 'surfaceBand curve points must be [x, y, z] or point3d' }
      pts.push(p)
    }
    if (pts.length < 2) return { error: 'SCENE_GEOMETRY_DEGENERATE: surfaceBand curve needs two points' }
    if (widths && widths.length !== pts.length) {
      return { error: `surfaceBand widths length ${widths.length} must match ${pts.length} curve points` }
    }
    const rs = pts.map((_, i) => (widths ? widths[i]! / 2 : half))
    if (rs.some((r) => r <= 0)) return { error: 'SCENE_GEOMETRY_DEGENERATE: surfaceBand width must be > 0' }
    for (let i = 0; i < pts.length; i++) hubs.push({ p: pts[i]!, r: rs[i]! })
    strands.push({ points: pts, radii: rs })
    return { hubs, strands }
  }

  const nodesIn = Array.isArray(rec.nodes) ? rec.nodes : []
  const nodes: Vec3[] = []
  for (const item of nodesIn) {
    const p = asPoint(item)
    if (!p) return { error: 'surfaceBand network nodes must be [x, y, z] or point3d' }
    nodes.push(p)
  }
  if (nodes.length === 0) return { error: 'SCENE_GEOMETRY_DEGENERATE: empty network' }
  if (widths && widths.length !== nodes.length) {
    return { error: `surfaceBand widths length ${widths.length} must match ${nodes.length} network nodes` }
  }
  const nodeR = nodes.map((_, i) => (widths ? widths[i]! / 2 : half))
  for (let i = 0; i < nodes.length; i++) {
    if (nodeR[i]! <= 0) return { error: 'SCENE_GEOMETRY_DEGENERATE: surfaceBand width must be > 0' }
    hubs.push({ p: nodes[i]!, r: nodeR[i]! })
  }
  const edges = Array.isArray(rec.edges) ? rec.edges as Array<Record<string, unknown>> : []
  for (const edge of edges) {
    const from = Number(edge.from)
    const to = Number(edge.to)
    const a = nodes[from]
    const b = nodes[to]
    if (!a || !b) return { error: 'SCENE_GEOMETRY_DEGENERATE: network edge is out of range' }
    const ra = nodeR[from]!
    const rb = nodeR[to]!
    const path = edge.curve ? curvePoints(edge.curve) : [a, b]
    const pts = path.length >= 2 ? [...path] : [a, b]
    pts[0] = a
    pts[pts.length - 1] = b
    const rs = pts.map((_, i) => ra + (rb - ra) * (pts.length === 1 ? 0 : i / (pts.length - 1)))
    for (let i = 1; i < pts.length - 1; i++) hubs.push({ p: pts[i]!, r: rs[i]! })
    strands.push({ points: pts, radii: rs })
  }
  return { hubs, strands }
}

function samplesOf(skel: Skeleton, spacing: number, metric: SurfaceBandMetric): Sample[] {
  const out = [...skel.hubs]
  for (const strand of skel.strands) {
    out.push(...densifyWithR(strand.points, strand.radii, spacing, metric))
  }
  return out
}

function closestOnTriangle(p: Vec3, a: Vec3, b: Vec3, c: Vec3): { q: Vec3; d: number } {
  const ab = sub(b, a)
  const ac = sub(c, a)
  const ap = sub(p, a)
  const d1 = dot(ab, ap)
  const d2 = dot(ac, ap)
  if (d1 <= 0 && d2 <= 0) return { q: a, d: dist(p, a) }
  const bp = sub(p, b)
  const d3 = dot(ab, bp)
  const d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return { q: b, d: dist(p, b) }
  const cp = sub(p, c)
  const d5 = dot(ab, cp)
  const d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return { q: c, d: dist(p, c) }
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / Math.max(d1 - d3, EPS)
    const q = add(a, scale(ab, v))
    return { q, d: dist(p, q) }
  }
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / Math.max(d2 - d6, EPS)
    const q = add(a, scale(ac, w))
    return { q, d: dist(p, q) }
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / Math.max(d4 - d3 + d5 - d6, EPS)
    const q = add(b, scale(sub(c, b), w))
    return { q, d: dist(p, q) }
  }
  const denom = Math.max(va + vb + vc, EPS)
  const v = vb / denom
  const w = vc / denom
  const q = add(a, add(scale(ab, v), scale(ac, w)))
  return { q, d: dist(p, q) }
}

function baryXY(px: number, py: number, a: Vec3, b: Vec3, c: Vec3): [number, number, number] | null {
  const v0x = b[0] - a[0]
  const v0y = b[1] - a[1]
  const v1x = c[0] - a[0]
  const v1y = c[1] - a[1]
  const den = v0x * v1y - v1x * v0y
  if (Math.abs(den) < 1e-14) return null
  const v2x = px - a[0]
  const v2y = py - a[1]
  const v = (v2x * v1y - v1x * v2y) / den
  const w = (v0x * v2y - v2x * v0y) / den
  const u = 1 - v - w
  if (u < -1e-6 || v < -1e-6 || w < -1e-6) return null
  return [u, v, w]
}

function faceHash(faces: number[], mesh: MeshView, cell: number): Map<string, number[]> {
  const buckets = new Map<string, number[]>()
  const inv = 1 / Math.max(cell, EPS)
  for (let f = 0; f < faces.length; f += 3) {
    const a = vert(mesh.positions, faces[f]!)
    const b = vert(mesh.positions, faces[f + 1]!)
    const c = vert(mesh.positions, faces[f + 2]!)
    const minX = Math.floor(Math.min(a[0], b[0], c[0]) * inv)
    const maxX = Math.floor(Math.max(a[0], b[0], c[0]) * inv)
    const minY = Math.floor(Math.min(a[1], b[1], c[1]) * inv)
    const maxY = Math.floor(Math.max(a[1], b[1], c[1]) * inv)
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        const key = `${x}:${y}`
        const list = buckets.get(key)
        if (list) list.push(f)
        else buckets.set(key, [f])
      }
    }
  }
  return buckets
}

function meanEdge(mesh: MeshView, faces: number[]): number {
  let sum = 0
  let n = 0
  for (let f = 0; f < faces.length; f += 3) {
    const a = vert(mesh.positions, faces[f]!)
    const b = vert(mesh.positions, faces[f + 1]!)
    const c = vert(mesh.positions, faces[f + 2]!)
    sum += dist(a, b) + dist(b, c) + dist(c, a)
    n += 3
  }
  return n > 0 ? sum / n : 1
}

function overlappingFaces(mesh: MeshView, samples: readonly Sample[], pad: number): number[] {
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (const s of samples) {
    minX = Math.min(minX, s.p[0] - pad)
    minY = Math.min(minY, s.p[1] - pad)
    minZ = Math.min(minZ, s.p[2] - pad)
    maxX = Math.max(maxX, s.p[0] + pad)
    maxY = Math.max(maxY, s.p[1] + pad)
    maxZ = Math.max(maxZ, s.p[2] + pad)
  }
  const out: number[] = []
  const indices = mesh.indices
  const pos = mesh.positions
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t]!
    const i1 = indices[t + 1]!
    const i2 = indices[t + 2]!
    const ax = pos[i0 * 3] ?? 0
    const ay = pos[i0 * 3 + 1] ?? 0
    const az = pos[i0 * 3 + 2] ?? 0
    const bx = pos[i1 * 3] ?? 0
    const by = pos[i1 * 3 + 1] ?? 0
    const bz = pos[i1 * 3 + 2] ?? 0
    const cx = pos[i2 * 3] ?? 0
    const cy = pos[i2 * 3 + 1] ?? 0
    const cz = pos[i2 * 3 + 2] ?? 0
    const loX = Math.min(ax, bx, cx)
    const hiX = Math.max(ax, bx, cx)
    const loY = Math.min(ay, by, cy)
    const hiY = Math.max(ay, by, cy)
    const loZ = Math.min(az, bz, cz)
    const hiZ = Math.max(az, bz, cz)
    if (hiX < minX || loX > maxX || hiY < minY || loY > maxY || hiZ < minZ || loZ > maxZ) continue
    out.push(i0, i1, i2)
  }
  return out
}

function hitFromFace(
  mesh: MeshView,
  faces: number[],
  f: number,
  q: Vec3,
  bary?: [number, number, number],
): Hit {
  const i0 = faces[f]!
  const i1 = faces[f + 1]!
  const i2 = faces[f + 2]!
  const a = vert(mesh.positions, i0)
  const b = vert(mesh.positions, i1)
  const c = vert(mesh.positions, i2)
  const n = normalize(cross(sub(b, a), sub(c, a)))
  let uv: [number, number] | undefined
  if (mesh.uvs && bary) {
    const ua = mesh.uvs[i0 * 2] ?? 0
    const va = mesh.uvs[i0 * 2 + 1] ?? 0
    const ub = mesh.uvs[i1 * 2] ?? 0
    const vb = mesh.uvs[i1 * 2 + 1] ?? 0
    const uc = mesh.uvs[i2 * 2] ?? 0
    const vc = mesh.uvs[i2 * 2 + 1] ?? 0
    uv = [
      bary[0] * ua + bary[1] * ub + bary[2] * uc,
      bary[0] * va + bary[1] * vb + bary[2] * vc,
    ]
  }
  return { p: q, n, ...(uv ? { uv } : {}) }
}

function createSampler(mesh: MeshView, faces: number[]): {
  vertical: (x: number, y: number, hintZ: number) => Hit | null
  closest: (p: Vec3) => Hit | null
  sit: (p: Vec3, metric: SurfaceBandMetric) => Hit | null
} {
  const cell = Math.max(meanEdge(mesh, faces) * 2, 0.5)
  const buckets = faceHash(faces, mesh, cell)
  const inv = 1 / cell
  const sit = Math.max(SIT_M, cell)

  const visitRing = (x: number, y: number, ring: number, visit: (f: number) => void) => {
    const cx = Math.floor(x * inv)
    const cy = Math.floor(y * inv)
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        const list = buckets.get(`${cx + dx}:${cy + dy}`)
        if (!list) continue
        for (const f of list) visit(f)
      }
    }
  }

  const vertical = (x: number, y: number, hintZ: number): Hit | null => {
    let best: Hit | null = null
    let bestDz = Infinity
    visitRing(x, y, 2, (f) => {
      const a = vert(mesh.positions, faces[f]!)
      const b = vert(mesh.positions, faces[f + 1]!)
      const c = vert(mesh.positions, faces[f + 2]!)
      const bary = baryXY(x, y, a, b, c)
      if (!bary) return
      const z = bary[0] * a[2] + bary[1] * b[2] + bary[2] * c[2]
      const dz = Math.abs(z - hintZ)
      if (dz < bestDz) {
        bestDz = dz
        best = hitFromFace(mesh, faces, f, [x, y, z], bary)
      }
    })
    return best
  }

  const closest = (p: Vec3): Hit | null => {
    let best = { d: Infinity, f: -1, q: p as Vec3 }
    const maxRing = Math.max(2, Math.ceil(sit / cell) + 1)
    for (let ring = 0; ring <= maxRing; ring++) {
      visitRing(p[0], p[1], ring, (f) => {
        const hit = closestOnTriangle(
          p,
          vert(mesh.positions, faces[f]!),
          vert(mesh.positions, faces[f + 1]!),
          vert(mesh.positions, faces[f + 2]!),
        )
        if (hit.d < best.d) best = { d: hit.d, f, q: hit.q }
      })
      if (best.f >= 0 && best.d <= sit) break
    }
    if (best.f < 0 || best.d > sit) return null
    return hitFromFace(mesh, faces, best.f, best.q)
  }

  const sitPoint = (p: Vec3, metric: SurfaceBandMetric): Hit | null => {
    if (metric === 'plan') return vertical(p[0], p[1], p[2]) ?? closest(p)
    return closest(p) ?? vertical(p[0], p[1], p[2])
  }

  return { vertical, closest, sit: sitPoint }
}

class BandMesh {
  private readonly pos: Vec3[] = []
  private readonly nrm: Vec3[] = []
  private readonly uv: ([number, number] | undefined)[] = []
  private readonly weld = new Map<string, number>()
  readonly indices: number[] = []
  private hasUv = false

  vert(hit: Hit | null): number {
    if (!hit) return -1
    const key = `${Math.round(hit.p[0] * 1000)}:${Math.round(hit.p[1] * 1000)}:${Math.round(hit.p[2] * 1000)}`
    const found = this.weld.get(key)
    if (found !== undefined) return found
    const id = this.pos.length
    this.pos.push(hit.p)
    this.nrm.push(hit.n)
    this.uv.push(hit.uv)
    if (hit.uv) this.hasUv = true
    this.weld.set(key, id)
    return id
  }

  tri(a: number, b: number, c: number): void {
    if (a < 0 || b < 0 || c < 0 || a === b || b === c || a === c) return
    this.indices.push(a, b, c)
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.tri(a, b, d)
    this.tri(b, c, d)
  }

  applyOffset(offset: number, metric: SurfaceBandMetric): void {
    if (offset === 0) return
    for (let i = 0; i < this.pos.length; i++) {
      const p = this.pos[i]!
      if (metric === 'plan') {
        this.pos[i] = [p[0], p[1], p[2] + offset]
      } else {
        this.pos[i] = add(p, scale(this.nrm[i] ?? [0, 0, 1], offset))
      }
    }
  }

  emit(): { positions: number[]; indices: number[]; uvs?: number[] } {
    const positions: number[] = []
    for (const p of this.pos) positions.push(p[0], p[1], p[2])
    const uvs = this.hasUv ? this.uv.flatMap((uv) => uv ? [uv[0], uv[1]] : [0, 0]) : undefined
    return { positions, indices: this.indices, ...(uvs ? { uvs } : {}) }
  }
}

function addDisk(
  mesh: BandMesh,
  sampler: ReturnType<typeof createSampler>,
  hub: Sample,
  spacing: number,
  metric: SurfaceBandMetric,
): void {
  const on = sampler.sit(hub.p, metric)
  if (!on) return
  const r = hub.r
  const nr = Math.max(1, Math.ceil(r / spacing))
  const ns = Math.max(12, Math.ceil((2 * Math.PI * r) / spacing))
  const [ax, ay] = metric === 'plan' ? [[1, 0, 0] as Vec3, [0, 1, 0] as Vec3] : tangentBasis(on.n)
  const rings: number[][] = [[mesh.vert(on)]]
  for (let ring = 1; ring <= nr; ring++) {
    const rr = r * (ring / nr)
    const row: number[] = []
    for (let s = 0; s < ns; s++) {
      const theta = (2 * Math.PI * s) / ns
      const raw = add(on.p, add(scale(ax, rr * Math.cos(theta)), scale(ay, rr * Math.sin(theta))))
      const hit = metric === 'plan'
        ? sampler.vertical(raw[0], raw[1], raw[2]) ?? sampler.closest(raw)
        : sampler.closest(raw) ?? sampler.vertical(raw[0], raw[1], raw[2])
      row.push(mesh.vert(hit))
    }
    rings.push(row)
  }
  const inner = rings[1]!
  const c = rings[0]![0]!
  for (let s = 0; s < ns; s++) mesh.tri(c, inner[s]!, inner[(s + 1) % ns]!)
  for (let ring = 1; ring < nr; ring++) {
    const a = rings[ring]!
    const b = rings[ring + 1]!
    for (let s = 0; s < ns; s++) {
      const t = (s + 1) % ns
      mesh.quad(a[s]!, a[t]!, b[t]!, b[s]!)
    }
  }
}

function addStrip(
  mesh: BandMesh,
  sampler: ReturnType<typeof createSampler>,
  a: Sample,
  b: Sample,
  spacing: number,
  metric: SurfaceBandMetric,
): void {
  const span = metric === 'plan' ? distXY(a.p, b.p) : dist(a.p, b.p)
  if (span < EPS) return
  const T = normalize(sub(b.p, a.p))
  const steps = Math.max(1, Math.ceil(span / spacing))
  const nv = Math.max(2, Math.ceil((a.r + b.r) / spacing))
  const rows: number[][] = []
  for (let k = 0; k <= steps; k++) {
    const t = k / steps
    const p = lerp(a.p, b.p, t)
    const r = a.r + (b.r - a.r) * t
    const on = sampler.sit(p, metric)
    if (!on) {
      rows.push([])
      continue
    }
    const B = metric === 'plan' ? xyPerp(T) : binormal(T, on.n)
    const row: number[] = []
    for (let j = 0; j <= nv; j++) {
      const n = -r + (2 * r * j) / nv
      const raw = add(on.p, scale(B, n))
      const hit = metric === 'plan'
        ? sampler.vertical(raw[0], raw[1], raw[2]) ?? sampler.closest(raw)
        : sampler.closest(raw) ?? sampler.vertical(raw[0], raw[1], raw[2])
      row.push(mesh.vert(hit))
    }
    rows.push(row)
  }
  for (let k = 0; k < rows.length - 1; k++) {
    const aRow = rows[k]!
    const bRow = rows[k + 1]!
    if (aRow.length === 0 || bRow.length === 0 || aRow.length !== bRow.length) continue
    for (let j = 0; j < aRow.length - 1; j++) {
      mesh.quad(aRow[j]!, aRow[j + 1]!, bRow[j + 1]!, bRow[j]!)
    }
  }
}

function gridSpacing(maxR: number): number {
  return Math.min(Math.max(maxR / 4, 0.35), 2)
}

export function buildSurfaceBand(input: Record<string, unknown>): {
  geometry?: {
    kind: 'mesh'
    positions: number[]
    indices: number[]
    uvs?: number[]
    role: 'band'
  }
  error?: string
} {
  const mesh = readMesh(input.mesh ?? input.surface)
  if ('error' in mesh) return mesh
  const rec = peel(input.geometry)
  if (!rec) return { error: 'surfaceBand requires 3D operating Geometry on the mesh' }
  const width = finite(input.width)
  if (!(width > 0)) return { error: 'SCENE_GEOMETRY_DEGENERATE: surfaceBand width must be > 0' }
  const widths = asNumberList(input.widths)
  const metric: SurfaceBandMetric = input.metric === 'plan' ? 'plan' : 'geodesic'
  const offset = finite(input.offset, 0)
  const skel = skeletonFromGeometry(rec, width, widths)
  if ('error' in skel) return skel
  if (skel.hubs.length === 0 && skel.strands.length === 0) {
    return { error: 'SCENE_GEOMETRY_DEGENERATE: surfaceBand skeleton is empty' }
  }
  const maxR = Math.max(
    ...skel.hubs.map((h) => h.r),
    ...skel.strands.flatMap((s) => s.radii),
    width / 2,
  )
  const spacing = gridSpacing(maxR)
  const samples = samplesOf(skel, spacing, metric)
  const faces = overlappingFaces(mesh, samples, maxR + SIT_M)
  if (faces.length < 3) return { error: 'SCENE_GEOMETRY_DEGENERATE: surfaceBand does not overlap the mesh' }
  const sampler = createSampler(mesh, faces)
  const band = new BandMesh()
  for (const hub of skel.hubs) addDisk(band, sampler, hub, spacing, metric)
  for (const strand of skel.strands) {
    const pts = strand.points
    const rs = strand.radii
    for (let i = 1; i < pts.length; i++) {
      addStrip(
        band,
        sampler,
        { p: pts[i - 1]!, r: rs[Math.min(i - 1, rs.length - 1)]! },
        { p: pts[i]!, r: rs[Math.min(i, rs.length - 1)]! },
        spacing,
        metric,
      )
    }
  }
  if (band.indices.length < 3) return { error: 'SCENE_GEOMETRY_DEGENERATE: surfaceBand is empty on this mesh' }
  band.applyOffset(offset, metric)
  const clipped = band.emit()
  return {
    geometry: {
      kind: 'mesh',
      positions: clipped.positions,
      indices: clipped.indices,
      ...(clipped.uvs ? { uvs: clipped.uvs } : {}),
      role: 'band',
    },
  }
}

export function surfaceBandSamples(input: Record<string, unknown>): SurfaceBandSample[] | { error: string } {
  const rec = peel(input.geometry)
  if (!rec) return { error: 'surfaceBand requires 3D operating Geometry' }
  const width = finite(input.width)
  const metric: SurfaceBandMetric = input.metric === 'plan' ? 'plan' : 'geodesic'
  const skel = skeletonFromGeometry(rec, width, asNumberList(input.widths))
  if ('error' in skel) return skel
  return samplesOf(skel, Math.max(width / 6, 0.25), metric)
}
