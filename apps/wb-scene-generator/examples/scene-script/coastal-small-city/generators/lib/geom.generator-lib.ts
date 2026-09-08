export function hashSeed(seed: number, salt: number): number {
  let x = (seed ^ (salt * 0x9e3779b9)) >>> 0
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return x >>> 0
}

export function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Point = readonly [number, number]

export function asPoint(value: unknown): Point | null {
  if (Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
    const x = Number(value[0])
    const y = Number(value[1])
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
  }
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
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number' && (value.length === 2 || typeof value[2] !== 'object')) {
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
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return Math.hypot(dx, dy)
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

export function signedDistanceToPolyline(point: Point, line: readonly Point[]): number {
  let best = Infinity
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!
    const b = line[i]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2))
    const px = a[0] + dx * t
    const py = a[1] + dy * t
    const d = Math.hypot(point[0] - px, point[1] - py)
    if (d < best) best = d
  }
  const first = line[0]
  const last = line[line.length - 1]
  if (!first || !last) return best
  const side = (last[0] - first[0]) * (point[1] - first[1]) - (last[1] - first[1]) * (point[0] - first[0])
  return side >= 0 ? best : -best
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

export function resamplePolyline(points: readonly Point[], spacing: number): Point[] {
  if (points.length < 2) return [...points]
  const out: Point[] = [points[0]!]
  let carry = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    let remaining = dist(a, b)
    let cursor = a
    while (carry + remaining >= spacing) {
      const t = (spacing - carry) / remaining
      const next = lerp(cursor, b, t)
      out.push(next)
      remaining -= spacing - carry
      cursor = next
      carry = 0
    }
    carry += remaining
  }
  out.push(points[points.length - 1]!)
  return out
}

export function tangentNormal(line: readonly Point[], index: number): Point {
  const prev = line[Math.max(0, index - 1)]!
  const next = line[Math.min(line.length - 1, index + 1)]!
  return normalOf(prev, next)
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

export type Aabb = { minX: number; minY: number; maxX: number; maxY: number }

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

/** Arc-length parameter of the closest point on an open polyline. */
export function nearestAlongT(line: readonly Point[], point: Point): number {
  if (line.length < 2) return 0
  const total = polylineLength(line)
  if (total < 1e-9) return 0
  let best = Infinity
  let bestAlong = 0
  let acc = 0
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!
    const b = line[i]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy || 1
    const len = Math.sqrt(len2)
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2))
    const d = Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dy * t))
    if (d < best) {
      best = d
      bestAlong = acc + t * len
    }
    acc += len
  }
  return bestAlong / total
}

/** Offset from a polyline at parameter t, choosing the side toward `toward`. */
export function offsetToward(line: readonly Point[], t: number, metres: number, toward: Point): Point {
  const p = alongPolyline(line, t)
  if (line.length < 2) return p
  const total = polylineLength(line)
  let remain = total * Math.max(0, Math.min(1, t))
  let a = line[0]!
  let b = line[Math.min(1, line.length - 1)]!
  for (let i = 1; i < line.length; i++) {
    a = line[i - 1]!
    b = line[i]!
    const seg = dist(a, b)
    if (remain <= seg) break
    remain -= seg
  }
  const n = normalOf(a, b)
  const left: Point = [p[0] + n[0] * metres, p[1] + n[1] * metres]
  const right: Point = [p[0] - n[0] * metres, p[1] - n[1] * metres]
  return dist(left, toward) <= dist(right, toward) ? left : right
}

export function simplifyPolyline(points: readonly Point[], eps: number): Point[] {
  if (points.length < 3) return [...points]
  const closed = dist(points[0]!, points[points.length - 1]!) < 1e-6
  const pts = closed ? points.slice(0, -1) : [...points]
  if (pts.length < 3) return closed ? closeRing(pts) : pts
  const keep = new Array(pts.length).fill(false)
  const visit = (i0: number, i1: number): void => {
    let maxD = 0
    let maxI = i0
    const a = pts[i0]!
    const b = pts[i1]!
    for (let i = i0 + 1; i < i1; i++) {
      const d = distToSegment(pts[i]!, a, b)
      if (d > maxD) {
        maxD = d
        maxI = i
      }
    }
    if (maxD > eps) {
      visit(i0, maxI)
      visit(maxI, i1)
    } else {
      keep[i0] = true
      keep[i1] = true
    }
  }
  visit(0, pts.length - 1)
  const out = pts.filter((_, i) => keep[i])
  return closed ? closeRing(out) : out
}

function distToSegment(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2))
  return Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dy * t))
}

export function closeRing(points: readonly Point[]): Point[] {
  const ring = points.filter((point, index) => {
    if (index === 0) return true
    return dist(point, points[index - 1]!) > 1e-6
  })
  if (ring.length >= 2 && dist(ring[0]!, ring[ring.length - 1]!) > 1e-6) ring.push(ring[0]!)
  return ring
}

export function rectBoundary(width: number, height: number, pad = 8): Point[] {
  return [
    [pad, pad],
    [width - pad, pad],
    [width - pad, height - pad],
    [pad, height - pad],
    [pad, pad],
  ]
}

/** Keep vertices with (p - origin) · outward <= 0. */
export function clipByHalfPlane(polygon: readonly Point[], origin: Point, outward: Point): Point[] {
  const ring = polygon.length >= 2 && dist(polygon[0]!, polygon[polygon.length - 1]!) < 1e-6
    ? polygon.slice(0, -1)
    : [...polygon]
  if (ring.length < 3) return []
  const inside = (point: Point): boolean =>
    (point[0] - origin[0]) * outward[0] + (point[1] - origin[1]) * outward[1] <= 1e-7
  const hit = (a: Point, b: Point): Point => {
    const da = (a[0] - origin[0]) * outward[0] + (a[1] - origin[1]) * outward[1]
    const db = (b[0] - origin[0]) * outward[0] + (b[1] - origin[1]) * outward[1]
    const t = da / ((da - db) || 1e-9)
    return lerp(a, b, t)
  }
  const out: Point[] = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    const aIn = inside(a)
    const bIn = inside(b)
    if (bIn) {
      if (!aIn) out.push(hit(a, b))
      out.push(b)
    } else if (aIn) {
      out.push(hit(a, b))
    }
  }
  return closeRing(out)
}

export function voronoiCells(sites: readonly Point[], boundary: readonly Point[]): Point[][] {
  const frame = closeRing(boundary)
  return sites.map((site, index) => {
    let poly = frame
    for (let other = 0; other < sites.length; other++) {
      if (other === index) continue
      const peer = sites[other]!
      const mid: Point = [(site[0] + peer[0]) / 2, (site[1] + peer[1]) / 2]
      poly = clipByHalfPlane(poly, mid, [peer[0] - site[0], peer[1] - site[1]])
      if (poly.length < 3) break
    }
    return poly
  })
}

export function jitterRing(polygon: readonly Point[], amount: number, random: () => number): Point[] {
  const ring = polygon.length >= 2 && dist(polygon[0]!, polygon[polygon.length - 1]!) < 1e-6
    ? polygon.slice(0, -1)
    : [...polygon]
  const jittered = ring.map((point) => {
    const a = random() * Math.PI * 2
    const r = (random() - 0.5) * 2 * amount
    return [point[0] + Math.cos(a) * r, point[1] + Math.sin(a) * r] as Point
  })
  return closeRing(jittered)
}

export function distToPolyline(point: Point, line: readonly Point[]): number {
  return Math.abs(signedDistanceToPolyline(point, line))
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / ((edge1 - edge0) || 1)))
  return t * t * (3 - 2 * t)
}

export function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const hash = (ix: number, iy: number): number => {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) >>> 0
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }
  const a = hash(x0, y0)
  const b = hash(x0 + 1, y0)
  const c = hash(x0, y0 + 1)
  const d = hash(x0 + 1, y0 + 1)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

/** Signed fBm in roughly [-1, 1]. */
export function fbm(x: number, y: number, seed: number, octaves = 5): number {
  let sum = 0
  let amp = 1
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += (valueNoise(x * freq, y * freq, seed + i * 101) * 2 - 1) * amp
    norm += amp
    amp *= 0.5
    freq *= 2.05
  }
  return sum / (norm || 1)
}

/** Ridged multifractal — sharp crests, softer valleys. */
export function ridgedFbm(x: number, y: number, seed: number, octaves = 5): number {
  let sum = 0
  let amp = 1
  let freq = 1
  let norm = 0
  let weight = 1
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise(x * freq, y * freq, seed + i * 131) * 2 - 1)
    const ridge = n * n * weight
    sum += ridge * amp
    norm += amp
    weight = Math.max(0, Math.min(1, ridge * 1.6))
    amp *= 0.5
    freq *= 2.15
  }
  return sum / (norm || 1)
}

export function domainWarp(
  x: number,
  y: number,
  seed: number,
  amount: number,
  scale: number,
): Point {
  const dx = fbm(x * scale, y * scale, seed, 4) * amount
  const dy = fbm(x * scale + 5.2, y * scale + 1.3, seed + 19, 4) * amount
  return [x + dx, y + dy]
}

/** Polynomial smooth-min for blending distance fields. */
export function smin(a: number, b: number, k: number): number {
  if (k <= 1e-6) return Math.min(a, b)
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

export function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k)
}

export function sdfCircle(point: Point, center: Point, radius: number): number {
  return dist(point, center) - radius
}

export function chaikin(points: readonly Point[], rounds = 2): Point[] {
  const closed = points.length >= 2 && dist(points[0]!, points[points.length - 1]!) < 1e-6
  let ring = closed ? points.slice(0, -1) : [...points]
  for (let r = 0; r < rounds; r++) {
    if (ring.length < 3) break
    const next: Point[] = []
    const n = ring.length
    const count = closed ? n : n - 1
    if (!closed) next.push(ring[0]!)
    for (let i = 0; i < count; i++) {
      const a = ring[i]!
      const b = ring[(i + 1) % n]!
      next.push(lerp(a, b, 0.25), lerp(a, b, 0.75))
    }
    if (!closed) next.push(ring[n - 1]!)
    ring = next
  }
  return closed ? closeRing(ring) : ring
}

/** Multi-octave normal displacement so a sparse coast Control becomes a crenulated shore. */
export function crenulateCoast(coast: readonly Point[], seed: number, spacing = 14, amount = 1): Point[] {
  const dense = resamplePolyline(coast, spacing)
  if (dense.length < 3) return [...dense]
  return dense.map((point, index) => {
    if (index === 0 || index === dense.length - 1) return point
    const prev = dense[index - 1]!
    const next = dense[Math.min(dense.length - 1, index + 1)]!
    const n = normalOf(prev, next)
    const large = fbm(point[0] / 130, point[1] / 130, seed, 4) * 52
    const mid = fbm(point[0] / 42, point[1] / 42, seed + 8, 4) * 18
    const cove = fbm(point[0] / 14, point[1] / 14, seed + 17, 3) * 5
    const offset = (large + mid + cove) * amount
    return [point[0] + n[0] * offset, point[1] + n[1] * offset] as Point
  })
}

export function takeEvery(points: readonly Point[], count: number): Point[] {
  if (points.length <= count) return [...points]
  const out: Point[] = []
  const last = points.length - 1
  for (let i = 0; i < count; i++) {
    out.push(points[Math.round((i / Math.max(1, count - 1)) * last)]!)
  }
  return out
}

export function fractalMeander(start: Point, end: Point, random: () => number, iterations = 5): Point[] {
  let pts: Point[] = [start, end]
  for (let iter = 0; iter < iterations; iter++) {
    const next: Point[] = [pts[0]!]
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!
      const b = pts[i + 1]!
      const mid = lerp(a, b, 0.5)
      const n = normalOf(a, b)
      const spread = dist(a, b) * (0.22 + random() * 0.1)
      const offset = (random() * 2 - 1) * spread
      next.push([mid[0] + n[0] * offset, mid[1] + n[1] * offset], b)
    }
    pts = next
  }
  return resamplePolyline(pts, 26)
}

/** Closest-segment signed distance. Positive is to the left of the walk. */
export function closestSignedDistance(point: Point, line: readonly Point[]): number {
  let best = Infinity
  let sign = 1
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!
    const b = line[i]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2))
    const px = a[0] + dx * t
    const py = a[1] + dy * t
    const d = Math.hypot(point[0] - px, point[1] - py)
    if (d < best) {
      best = d
      const cross = dx * (point[1] - a[1]) - dy * (point[0] - a[0])
      sign = cross >= 0 ? 1 : -1
    }
  }
  return best * sign
}

export function landSignToward(probe: Point, line: readonly Point[]): number {
  const signed = closestSignedDistance(probe, line)
  return signed >= 0 ? 1 : -1
}

export function inlandDistance(point: Point, line: readonly Point[], landSign: number): number {
  return closestSignedDistance(point, line) * landSign
}

/**
 * Close an open coast into the sea region. Side is chosen by a land probe,
 * not by segment winding — zigzag controls cannot flip ocean pockets to land.
 */
export function seaPolygonFromCoast(
  coast: readonly Point[],
  width: number,
  height: number,
  landProbe: Point,
): Point[] {
  if (coast.length === 0) return [[0, height], [width, height], [width, 0], [0, 0]]
  const south: Point[] = [[0, height], ...coast, [width, height]]
  return pointInPolygon(landProbe, south) ? [[0, 0], ...coast, [width, 0]] : south
}

/** + inland / − sea. Sign comes from the closed sea polygon, magnitude from the coast polyline. */
export function signedCoastDistance(point: Point, coast: readonly Point[], sea: readonly Point[]): number {
  const mag = distToPolyline(point, coast)
  if (mag <= 1e-4) return 0
  return pointInPolygon(point, sea) ? -mag : mag
}

export function convexHull(points: readonly Point[]): Point[] {
  const unique = [...points].sort((a, b) => a[0] === b[0] ? a[1] - b[1] : a[0] - b[0])
  if (unique.length < 3) return closeRing(unique)
  const cross = (o: Point, a: Point, b: Point): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Point[] = []
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return closeRing(lower.concat(upper))
}

export function wanderPolyline(start: Point, end: Point, spacing: number, amplitude: number, random: () => number): Point[] {
  const base = resamplePolyline([start, end], spacing)
  if (base.length < 3) return base
  return base.map((point, index) => {
    if (index === 0 || index === base.length - 1) return point
    const prev = base[index - 1]!
    const next = base[Math.min(base.length - 1, index + 1)]!
    const n = normalOf(prev, next)
    const falloff = Math.sin((index / (base.length - 1)) * Math.PI)
    const offset = (random() * 2 - 1) * amplitude * falloff
    return [point[0] + n[0] * offset, point[1] + n[1] * offset] as Point
  })
}

export function raiseAlongPolyline(
  grid: number[][],
  cellSize: number,
  line: readonly Point[],
  width: number,
  amount: number,
): void {
  if (line.length < 2 || width <= 0) return
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = (x + 0.5) * cellSize
      const py = (y + 0.5) * cellSize
      const d = distToPolyline([px, py], line)
      if (d >= width) continue
      const w = (1 - d / width) ** 2
      grid[y]![x] += amount * w
    }
  }
}

export function lerp3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  const u = t < 0 ? 0 : t > 1 ? 1 : t
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
}

export function buildHeightGridMesh(
  metres: number[][],
  cellSize: number,
  colorAt: (x: number, y: number, z: number, slope: number) => readonly [number, number, number],
): MeshArrays {
  const rows = metres.length
  const cols = metres[0]?.length ?? 0
  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const sample = (x: number, y: number): number => metres[Math.max(0, Math.min(rows - 1, y))]![Math.max(0, Math.min(cols - 1, x))]!
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const z = sample(x, y)
      const zx = (sample(x + 1, y) - sample(x - 1, y)) / (2 * cellSize)
      const zy = (sample(x, y + 1) - sample(x, y - 1)) / (2 * cellSize)
      const nx = -zx
      const ny = zy
      const nz = 1
      const nlen = Math.hypot(nx, ny, nz) || 1
      const px = (x + 0.5) * cellSize
      const py = (y + 0.5) * cellSize
      const slope = Math.hypot(zx, zy)
      const rgb = colorAt(px, py, z, slope)
      positions.push(px, -py, z)
      normals.push(nx / nlen, ny / nlen, nz / nlen)
      colors.push(rgb[0], rgb[1], rgb[2])
    }
  }
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const i00 = y * cols + x
      const i10 = i00 + 1
      const i01 = i00 + cols
      const i11 = i01 + 1
      indices.push(i00, i10, i11, i00, i11, i01)
    }
  }
  return { positions, indices, normals, colors, color: [0.45, 0.52, 0.38], role: 'terrain' }
}

export function occupancyCentroid(
  occupancy: (point: Point) => number,
  box: Aabb,
  cellSize: number,
): Point | null {
  const cell = cellSize || 8
  let sx = 0
  let sy = 0
  let n = 0
  const x0 = Math.floor(box.minX / cell)
  const y0 = Math.floor(box.minY / cell)
  const x1 = Math.ceil(box.maxX / cell)
  const y1 = Math.ceil(box.maxY / cell)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const point: Point = [(x + 0.5) * cell, (y + 0.5) * cell]
      if (occupancy(point) > 0) {
        sx += point[0]
        sy += point[1]
        n += 1
      }
    }
  }
  return n > 0 ? [sx / n, sy / n] : null
}

export function occupancyRing(
  occupancy: (point: Point) => number,
  box: Aabb,
  cellSize: number,
): Point[] {
  const cell = cellSize || 8
  const x0 = Math.floor(box.minX / cell) - 1
  const y0 = Math.floor(box.minY / cell) - 1
  const x1 = Math.ceil(box.maxX / cell) + 1
  const y1 = Math.ceil(box.maxY / cell) + 1
  const adj = new Map<string, Point[]>()
  const add = (a: Point, b: Point): void => {
    const pa = snapPoint(a)
    const pb = snapPoint(b)
    if (dist(pa, pb) < 1e-4) return
    const ka = pointKey(pa)
    const kb = pointKey(pb)
    const la = adj.get(ka)
    if (la) la.push(pb)
    else adj.set(ka, [pb])
    const lb = adj.get(kb)
    if (lb) lb.push(pa)
    else adj.set(kb, [pa])
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      for (const [a, b] of msContour(occupancy, x, y, cell)) add(a, b)
    }
  }
  let best: Point[] = []
  const seen = new Set<string>()
  for (const startKey of adj.keys()) {
    if (seen.has(startKey)) continue
    const ring: Point[] = []
    let key = startKey
    let prev = ''
    for (let step = 0; step < adj.size + 2; step++) {
      if (seen.has(key) && ring.length > 2) break
      seen.add(key)
      const [sx, sy] = key.split(',').map(Number) as [number, number]
      ring.push([sx, sy])
      const next = (adj.get(key) ?? []).find((p) => pointKey(p) !== prev) ?? adj.get(key)?.[0]
      if (!next) break
      prev = key
      key = pointKey(next)
      if (key === startKey) {
        ring.push(ring[0]!)
        break
      }
    }
    if (ring.length > best.length) best = ring
  }
  return best.length >= 4 ? closeRing(best) : []
}

export function buildOccupancyPatchMesh(
  occupancy: (point: Point) => number,
  box: Aabb,
  heightGrid: number[][],
  cellSize: number,
  opts?: {
    lift?: number
    color?: readonly [number, number, number]
    role?: MeshArrays['role']
    heightCell?: number
  },
): MeshArrays {
  const color = opts?.color ?? [0.82, 0.72, 0.42]
  const lift = opts?.lift ?? 0.04
  const cell = cellSize || 8
  const heightCell = opts?.heightCell && opts.heightCell > 0 ? opts.heightCell : cell
  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const x0 = Math.floor(box.minX / cell) - 1
  const y0 = Math.floor(box.minY / cell) - 1
  const x1 = Math.ceil(box.maxX / cell) + 1
  const y1 = Math.ceil(box.maxY / cell) + 1
  const zOf = (point: Point): number => sampleGridHeight(heightGrid, heightCell, point) + lift
  const emit = (pts: readonly Point[]): void => {
    if (pts.length < 3) return
    const origin = positions.length / 3
    for (const point of pts) {
      positions.push(point[0], -point[1], zOf(point))
      normals.push(0, 0, 1)
      colors.push(color[0], color[1], color[2])
    }
    for (let i = 1; i < pts.length - 1; i++) indices.push(origin, origin + i, origin + i + 1)
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const sample = msSample(occupancy, x, y, cell)
      if (sample.mask === 0) continue
      if (sample.mask === 15) {
        emit([sample.c0, sample.c1, sample.c2, sample.c3])
        continue
      }
      const { c0, c1, c2, c3, e0, e1, e2, e3, mask, centerIn } = sample
      if (mask === 1) emit([c0, e0, e3])
      else if (mask === 2) emit([c1, e1, e0])
      else if (mask === 3) emit([c0, c1, e1, e3])
      else if (mask === 4) emit([c2, e2, e1])
      else if (mask === 5) {
        if (centerIn) emit([c0, e0, e1, c2, e2, e3])
        else {
          emit([c0, e0, e3])
          emit([c2, e2, e1])
        }
      } else if (mask === 6) emit([c1, c2, e2, e0])
      else if (mask === 7) emit([c0, c1, c2, e2, e3])
      else if (mask === 8) emit([c3, e3, e2])
      else if (mask === 9) emit([c0, e0, e2, c3])
      else if (mask === 10) {
        if (centerIn) emit([c1, e1, e2, c3, e3, e0])
        else {
          emit([c1, e1, e0])
          emit([c3, e3, e2])
        }
      } else if (mask === 11) emit([c0, c1, e1, e2, c3])
      else if (mask === 12) emit([c2, c3, e3, e1])
      else if (mask === 13) emit([c0, e0, e1, c2, c3])
      else if (mask === 14) emit([c1, c2, c3, e3, e0])
    }
  }
  return { positions, indices, normals, colors, color, role: opts?.role ?? 'houses' }
}

export function buildRegionPatchMesh(
  polygon: readonly Point[],
  heightGrid: number[][],
  cellSize: number,
  opts?: {
    lift?: number
    color?: readonly [number, number, number]
    role?: MeshArrays['role']
    heightCell?: number
  },
): MeshArrays {
  const ring = closeRing(polygon)
  if (ring.length < 4) {
    return buildOccupancyPatchMesh(() => -1, { minX: 0, minY: 0, maxX: 0, maxY: 0 }, heightGrid, cellSize, opts)
  }
  const occ = (point: Point): number => {
    const d = distToPolyline(point, ring)
    return (pointInPolygon(point, ring) ? 1 : -1) * Math.max(d, 1e-4)
  }
  return buildOccupancyPatchMesh(occ, aabbOf(ring), heightGrid, cellSize, opts)
}

type MsSample = {
  c0: Point
  c1: Point
  c2: Point
  c3: Point
  e0: Point
  e1: Point
  e2: Point
  e3: Point
  mask: number
  centerIn: boolean
}

function isoEdge(a: Point, b: Point, va: number, vb: number): Point {
  const t = va / ((va - vb) || 1e-9)
  return lerp(a, b, Math.max(0, Math.min(1, t)))
}

function msSample(occupancy: (point: Point) => number, x: number, y: number, cell: number): MsSample {
  const c0: Point = [x * cell, y * cell]
  const c1: Point = [(x + 1) * cell, y * cell]
  const c2: Point = [(x + 1) * cell, (y + 1) * cell]
  const c3: Point = [x * cell, (y + 1) * cell]
  const v0 = occupancy(c0)
  const v1 = occupancy(c1)
  const v2 = occupancy(c2)
  const v3 = occupancy(c3)
  return {
    c0, c1, c2, c3,
    e0: isoEdge(c0, c1, v0, v1),
    e1: isoEdge(c1, c2, v1, v2),
    e2: isoEdge(c2, c3, v2, v3),
    e3: isoEdge(c3, c0, v3, v0),
    mask: (v0 > 0 ? 1 : 0) | (v1 > 0 ? 2 : 0) | (v2 > 0 ? 4 : 0) | (v3 > 0 ? 8 : 0),
    centerIn: v0 + v1 + v2 + v3 > 0,
  }
}

function msContour(occupancy: (point: Point) => number, x: number, y: number, cell: number): Array<[Point, Point]> {
  const { e0, e1, e2, e3, mask, centerIn } = msSample(occupancy, x, y, cell)
  if (mask === 0 || mask === 15) return []
  if (mask === 1) return [[e3, e0]]
  if (mask === 2) return [[e0, e1]]
  if (mask === 3) return [[e3, e1]]
  if (mask === 4) return [[e1, e2]]
  if (mask === 5) return centerIn ? [[e0, e1], [e2, e3]] : [[e3, e0], [e1, e2]]
  if (mask === 6) return [[e0, e2]]
  if (mask === 7) return [[e3, e2]]
  if (mask === 8) return [[e2, e3]]
  if (mask === 9) return [[e0, e2]]
  if (mask === 10) return centerIn ? [[e1, e2], [e3, e0]] : [[e0, e1], [e2, e3]]
  if (mask === 11) return [[e1, e2]]
  if (mask === 12) return [[e1, e3]]
  if (mask === 13) return [[e0, e1]]
  return [[e0, e3]]
}

function snapPoint(point: Point): Point {
  return [Math.round(point[0] * 20) / 20, Math.round(point[1] * 20) / 20]
}

function pointKey(point: Point): string {
  const p = snapPoint(point)
  return `${p[0]},${p[1]}`
}

export function bilinearHeight(grid: number[][], cell: number, point: Point): number {
  const rows = grid.length
  if (rows === 0) return 8
  const cols = grid[0]?.length ?? 0
  if (cols === 0) return 8
  const gx = point[0] / cell - 0.5
  const gy = point[1] / cell - 0.5
  const x0 = Math.max(0, Math.min(cols - 1, Math.floor(gx)))
  const x1 = Math.max(0, Math.min(cols - 1, x0 + 1))
  const y0 = Math.max(0, Math.min(rows - 1, Math.floor(gy)))
  const y1 = Math.max(0, Math.min(rows - 1, y0 + 1))
  const tx = Math.max(0, Math.min(1, gx - x0))
  const ty = Math.max(0, Math.min(1, gy - y0))

  const z00 = (grid[y0]![x0] ?? 1) * cell
  const z10 = (grid[y0]![x1] ?? 1) * cell
  const z01 = (grid[y1]![x0] ?? 1) * cell
  const z11 = (grid[y1]![x1] ?? 1) * cell

  const z0 = z00 * (1 - tx) + z10 * tx
  const z1 = z01 * (1 - tx) + z11 * tx
  return z0 * (1 - ty) + z1 * ty
}

function heightAtGrid(grid: number[][], cell: number, point: Point): number {
  return bilinearHeight(grid, cell, point)
}

export function sampleGridHeight(grid: number[][], cell: number, point: Point): number {
  return bilinearHeight(grid, cell, point)
}

/** Closest segment tangent vector (normalized). */
export function tangentAtPolyline(line: readonly Point[], point: Point): Point {
  if (line.length < 2) return [1, 0]
  let best = Infinity
  let tangent: Point = [1, 0]
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!
    const b = line[i]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (len * len)))
    const px = a[0] + dx * t
    const py = a[1] + dy * t
    const d = Math.hypot(point[0] - px, point[1] - py)
    if (d < best) {
      best = d
      tangent = [dx / len, dy / len]
    }
  }
  return tangent
}

/** 2D Directional Tensor Field evaluator */
export type CoastalTensorField = (point: Point) => {
  primary: Point
  secondary: Point
  shoreDist: number
  creekDist: number
}

/**
 * Builds a smooth 2D tensor field from shoreline, river, and heightfield contours.
 * Uses nematic 2-angle tensor blending to prevent sign flips across curves.
 */
export function buildCoastalTensorField(opts: {
  shoreline?: readonly Point[]
  creek?: readonly Point[]
  heightGrid?: number[][]
  cellSize?: number
  cityBoundary?: readonly Point[]
}): CoastalTensorField {
  const shore = opts.shoreline ?? []
  const creek = opts.creek ?? []
  const grid = opts.heightGrid
  const cell = opts.cellSize ?? 8

  return (point: Point) => {
    let sumCos2 = 0
    let sumSin2 = 0
    let totalWeight = 0

    const shoreDist = shore.length >= 2 ? distToPolyline(point, shore) : 999
    if (shore.length >= 2) {
      const tan = tangentAtPolyline(shore, point)
      const theta = Math.atan2(tan[1], tan[0])
      const w = Math.exp(-((shoreDist / 140) ** 2)) * 1.5
      sumCos2 += w * Math.cos(2 * theta)
      sumSin2 += w * Math.sin(2 * theta)
      totalWeight += w
    }

    const creekDist = creek.length >= 2 ? distToPolyline(point, creek) : 999
    if (creek.length >= 2) {
      const tan = tangentAtPolyline(creek, point)
      const theta = Math.atan2(tan[1], tan[0])
      const w = Math.exp(-((creekDist / 80) ** 2)) * 1.2
      sumCos2 += w * Math.cos(2 * theta)
      sumSin2 += w * Math.sin(2 * theta)
      totalWeight += w
    }

    if (grid && grid.length > 2 && grid[0] && grid[0].length > 2) {
      const cols = grid[0].length
      const rows = grid.length
      const gx = Math.max(1, Math.min(cols - 2, Math.floor(point[0] / cell)))
      const gy = Math.max(1, Math.min(rows - 2, Math.floor(point[1] / cell)))
      const dzdx = (grid[gy]![gx + 1]! - grid[gy]![gx - 1]!) * 0.5
      const dzdy = (grid[gy + 1]![gx]! - grid[gy - 1]![gx]!) * 0.5
      const gradLen = Math.hypot(dzdx, dzdy)
      if (gradLen > 0.04) {
        // Contour tangent is perpendicular to gradient
        const theta = Math.atan2(dzdx, -dzdy)
        const w = smoothstep(60, 240, shoreDist) * 0.7
        sumCos2 += w * Math.cos(2 * theta)
        sumSin2 += w * Math.sin(2 * theta)
        totalWeight += w
      }
    }

    let angle = 0
    if (totalWeight > 1e-4) {
      angle = 0.5 * Math.atan2(sumSin2, sumCos2)
    }

    const primary: Point = [Math.cos(angle), Math.sin(angle)]
    const secondary: Point = [-Math.sin(angle), Math.cos(angle)]
    return { primary, secondary, shoreDist, creekDist }
  }
}

/** Determine the unit normal pointing inland (towards city land) from a shoreline polyline */
export function inlandNormalAtPolyline(
  line: readonly Point[],
  point: Point,
  cityBoundary?: readonly Point[],
): Point {
  if (line.length < 2) return [0, -1]
  const tan = tangentAtPolyline(line, point)
  const n1: Point = [-tan[1], tan[0]]
  const n2: Point = [tan[1], -tan[0]]

  if (cityBoundary && cityBoundary.length >= 3) {
    const p1: Point = [point[0] + n1[0] * 12, point[1] + n1[1] * 12]
    const p2: Point = [point[0] + n2[0] * 12, point[1] + n2[1] * 12]
    const in1 = pointInPolygon(p1, cityBoundary)
    const in2 = pointInPolygon(p2, cityBoundary)
    if (in1 && !in2) return n1
    if (in2 && !in1) return n2
    const c = centroidOf(cityBoundary)
    const d1 = dist(p1, c)
    const d2 = dist(p2, c)
    return d1 <= d2 ? n1 : n2
  }
  return n1
}

/** Offset a polyline along normal direction with smooth normal filtering */
export function offsetPolyline(
  line: readonly Point[],
  distance: number,
  getNormal?: (point: Point) => Point,
): Point[] {
  if (line.length < 2) return [...line]
  const rawNormals: Point[] = []
  for (let i = 0; i < line.length; i++) {
    const p = line[i]!
    let norm: Point
    if (getNormal) {
      norm = getNormal(p)
    } else {
      const prev = line[Math.max(0, i - 1)]!
      const next = line[Math.min(line.length - 1, i + 1)]!
      norm = normalOf(prev, next)
    }
    rawNormals.push(norm)
  }

  // Smooth normals with 3-tap Gaussian-like filter to avoid pinch points
  const smoothedNormals: Point[] = []
  for (let i = 0; i < rawNormals.length; i++) {
    const p0 = rawNormals[Math.max(0, i - 1)]!
    const p1 = rawNormals[i]!
    const p2 = rawNormals[Math.min(rawNormals.length - 1, i + 1)]!
    const nx = p0[0] * 0.25 + p1[0] * 0.5 + p2[0] * 0.25
    const ny = p0[1] * 0.25 + p1[1] * 0.5 + p2[1] * 0.25
    const len = Math.hypot(nx, ny) || 1
    smoothedNormals.push([nx / len, ny / len])
  }

  const out: Point[] = []
  for (let i = 0; i < line.length; i++) {
    const p = line[i]!
    const norm = smoothedNormals[i]!
    out.push([p[0] + norm[0] * distance, p[1] + norm[1] * distance])
  }
  return out
}

/** Clip a polyline to polygon, returning contiguous polyline segments inside the polygon */
export function clipPolylineToPolygon(
  line: readonly Point[],
  polygon: readonly Point[],
): Point[][] {
  if (line.length < 2 || polygon.length < 3) return []
  const segments: Point[][] = []
  let current: Point[] = []

  const sampled = resamplePolyline(line, 6)
  for (const pt of sampled) {
    if (pointInPolygon(pt, polygon)) {
      current.push(pt)
    } else {
      if (current.length >= 2) {
        segments.push(simplifyPolyline(current, 1.5))
      }
      current = []
    }
  }
  if (current.length >= 2) {
    segments.push(simplifyPolyline(current, 1.5))
  }
  return segments
}

/** Check if two 2D segments (a-b) and (c-d) intersect. */
export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (p: Point, q: Point, r: Point): number =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = cross(a, b, c)
  const d2 = cross(a, b, d)
  const d3 = cross(c, d, a)
  const d4 = cross(c, d, b)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** Exact intersection point between two segments, if any. */
export function segmentIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  const dXab = b[0] - a[0]
  const dYab = b[1] - a[1]
  const dXcd = d[0] - c[0]
  const dYcd = d[1] - c[1]
  const denom = dXab * dYcd - dYab * dXcd
  if (Math.abs(denom) < 1e-7) return null
  const t = ((c[0] - a[0]) * dYcd - (c[1] - a[1]) * dXcd) / denom
  const u = ((c[0] - a[0]) * dYab - (c[1] - a[1]) * dXab) / denom
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return [a[0] + t * dXab, a[1] + t * dYab]
  }
  return null
}

export type BridgeCrossing = {
  key: string
  center: Point
  leftBank: Point
  rightBank: Point
  span: number
  polyline: Point[]
}

/** Find natural cross-river bridge sites connecting east and west districts. */
export function findRiverBridgeSites(
  creek: readonly Point[],
  shoreline: readonly Point[],
  cityBoundary: readonly Point[],
  opts?: { minInland?: number; maxInland?: number; spanWidth?: number },
): BridgeCrossing[] {
  if (creek.length < 4) return []
  const span = opts?.spanWidth ?? 24
  const minInland = opts?.minInland ?? 30
  const maxInland = opts?.maxInland ?? 420
  const crossings: BridgeCrossing[] = []

  const targetDistances = [90, 220]
  for (let idx = 0; idx < targetDistances.length; idx++) {
    const targetD = targetDistances[idx]!
    let bestPoint: Point = creek[Math.floor(creek.length / 2)]!
    let bestDistDiff = Infinity
    let bestIdx = -1

    for (let i = 0; i < creek.length; i++) {
      const p = creek[i]!
      if (cityBoundary.length >= 3 && !pointInPolygon(p, cityBoundary)) continue
      const shoreD = shoreline.length >= 2 ? distToPolyline(p, shoreline) : targetD
      if (shoreD < minInland || shoreD > maxInland) continue
      const diff = Math.abs(shoreD - targetD)
      if (diff < bestDistDiff) {
        bestDistDiff = diff
        bestPoint = p
        bestIdx = i
      }
    }

    if (bestIdx < 0) {
      // Fallback to proportional position along creek if boundary/distance test was too strict
      const frac = idx === 0 ? 0.35 : 0.65
      bestIdx = Math.max(1, Math.min(creek.length - 2, Math.floor(creek.length * frac)))
      bestPoint = creek[bestIdx]!
    }

    const rawN = tangentNormal(creek, bestIdx)
    // Orient normal perpendicular to river so leftBank is on the west and rightBank is on the east
    const n: Point = rawN[0] < 0 ? rawN : [-rawN[0], -rawN[1]]
    const left: Point = [bestPoint[0] + n[0] * (span * 0.5), bestPoint[1] + n[1] * (span * 0.5)]
    const right: Point = [bestPoint[0] - n[0] * (span * 0.5), bestPoint[1] - n[1] * (span * 0.5)]
    crossings.push({
      key: `bridge-${idx}`,
      center: bestPoint,
      leftBank: left,
      rightBank: right,
      span,
      polyline: [left, bestPoint, right],
    })
  }

  return crossings
}

/**
 * Anisotropic path router connecting key hubs while respecting slope and river barriers.
 */
export function routeAnisotropicPath(
  start: Point,
  end: Point,
  opts: {
    heightGrid?: number[][]
    cellSize?: number
    boundary?: readonly Point[]
    creek?: readonly Point[]
    bridges?: readonly BridgeCrossing[]
    stepSize?: number
  },
): Point[] {
  const step = opts.stepSize ?? 16
  const cell = opts.cellSize ?? 8
  const grid = opts.heightGrid
  const boundary = opts.boundary ?? []
  const creek = opts.creek ?? []
  const bridges = opts.bridges ?? []

  const minX = Math.min(start[0], end[0]) - 60
  const maxX = Math.max(start[0], end[0]) + 60
  const minY = Math.min(start[1], end[1]) - 60
  const maxY = Math.max(start[1], end[1]) + 60

  const cols = Math.max(4, Math.ceil((maxX - minX) / step))
  const rows = Math.max(4, Math.ceil((maxY - minY) / step))

  const toCoord = (c: number, r: number): Point => [minX + c * step, minY + r * step]
  const startC = Math.max(0, Math.min(cols - 1, Math.round((start[0] - minX) / step)))
  const startR = Math.max(0, Math.min(rows - 1, Math.round((start[1] - minY) / step)))
  const endC = Math.max(0, Math.min(cols - 1, Math.round((end[0] - minX) / step)))
  const endR = Math.max(0, Math.min(rows - 1, Math.round((end[1] - minY) / step)))

  const keyOf = (c: number, r: number) => c + r * cols
  const distGraph = new Map<number, number>()
  const cameFrom = new Map<number, number>()
  const startKey = keyOf(startC, startR)
  const endKey = keyOf(endC, endR)

  type QueueItem = { key: number; c: number; r: number; cost: number; est: number }
  const queue: QueueItem[] = [{ key: startKey, c: startC, r: startR, cost: 0, est: dist(start, end) }]
  distGraph.set(startKey, 0)

  const isCrossBridge = (p1: Point, p2: Point): boolean =>
    bridges.some((b) => dist(p1, b.center) < b.span * 1.2 || dist(p2, b.center) < b.span * 1.2)

  const crossesCreek = (p1: Point, p2: Point): boolean => {
    if (creek.length < 2) return false
    if (isCrossBridge(p1, p2)) return false
    for (let i = 1; i < creek.length; i++) {
      if (segmentsIntersect(p1, p2, creek[i - 1]!, creek[i]!)) return true
    }
    return false
  }

  let found = false
  let iterations = 0
  const maxIters = 2500

  while (queue.length > 0 && iterations++ < maxIters) {
    queue.sort((a, b) => a.est - b.est)
    const current = queue.shift()!
    if (current.key === endKey) {
      found = true
      break
    }

    const currPos = toCoord(current.c, current.r)
    const currZ = grid ? sampleGridHeight(grid, cell, currPos) : 0

    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (dc === 0 && dr === 0) continue
        const nc = current.c + dc
        const nr = current.r + dr
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue
        const nextKey = keyOf(nc, nr)
        const nextPos = toCoord(nc, nr)

        if (boundary.length >= 3 && !pointInPolygon(nextPos, boundary)) continue

        const segDist = dist(currPos, nextPos)
        let edgeCost = segDist

        if (grid) {
          const nextZ = sampleGridHeight(grid, cell, nextPos)
          const slope = Math.abs(nextZ - currZ) / segDist
          if (slope > 0.08) {
            edgeCost += (slope / 0.08) ** 2 * 30 * segDist
          }
        }

        if (crossesCreek(currPos, nextPos)) {
          edgeCost += 1200
        }

        const newCost = current.cost + edgeCost
        if (newCost < (distGraph.get(nextKey) ?? Infinity)) {
          distGraph.set(nextKey, newCost)
          cameFrom.set(nextKey, current.key)
          const est = newCost + dist(nextPos, end)
          queue.push({ key: nextKey, c: nc, r: nr, cost: newCost, est })
        }
      }
    }
  }

  if (!found) {
    return [start, end]
  }

  const rawWaypoints: Point[] = [end]
  let curr = endKey
  while (curr !== startKey) {
    const parent = cameFrom.get(curr)
    if (parent === undefined) break
    const c = parent % cols
    const r = Math.floor(parent / cols)
    rawWaypoints.push(toCoord(c, r))
    curr = parent
  }
  rawWaypoints.push(start)
  rawWaypoints.reverse()

  const simplified = simplifyPolyline(rawWaypoints, 6)
  return resamplePolyline(chaikin(simplified, 2), 14)
}

/**
 * Traces a streamline along a 2D tensor field until boundary or obstacle collision.
 */
export function traceTensorStreamline(
  start: Point,
  initialDir: Point,
  field: CoastalTensorField,
  opts: {
    stepSize?: number
    maxSteps?: number
    boundary?: readonly Point[]
    existingLines?: readonly Point[][]
    minDistanceToExisting?: number
    followSecondary?: boolean
  },
): Point[] {
  const step = opts.stepSize ?? 12
  const maxSteps = opts.maxSteps ?? 40
  const boundary = opts.boundary ?? []
  const existing = opts.existingLines ?? []
  const minDist = opts.minDistanceToExisting ?? 14
  const useSecondary = opts.followSecondary ?? false

  const points: Point[] = [start]
  let current = start
  let prevDir: Point = initialDir

  for (let i = 0; i < maxSteps; i++) {
    const sample = field(current)
    const baseVec = useSecondary ? sample.secondary : sample.primary

    // Match direction sign with previous vector to prevent sudden U-turns
    const dot = baseVec[0] * prevDir[0] + baseVec[1] * prevDir[1]
    const dir: Point = dot >= 0 ? baseVec : [-baseVec[0], -baseVec[1]]

    const next: Point = [current[0] + dir[0] * step, current[1] + dir[1] * step]

    if (boundary.length >= 3 && !pointInPolygon(next, boundary)) {
      points.push(next)
      break
    }

    // Stop if close to existing roads (excluding initial launch)
    if (i > 2 && existing.some((line) => distToPolyline(next, line) < minDist)) {
      points.push(next)
      break
    }

    points.push(next)
    current = next
    prevDir = dir
  }

  return points.length >= 2 ? simplifyPolyline(points, 2) : []
}

export function nearestIndex(point: Point, candidates: readonly Point[]): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < candidates.length; i++) {
    const d = dist(point, candidates[i]!)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

export interface MeshArrays {
  positions: number[]
  indices: number[]
  normals: number[]
  colors: number[]
  color: readonly [number, number, number]
  role: 'road' | 'houses' | 'terrain'
}

/** Authoring metres → mesh (X, -Y, Z), same convention as sweep / boxes. */
export function buildRibbonMesh(
  polylines: ReadonlyArray<{ points: readonly Point[]; width: number; kind?: string }>,
  opts?: {
    lift?: number
    color?: readonly [number, number, number]
    role?: MeshArrays['role']
    heightAt?: (point: Point) => number
    junctions?: ReadonlyArray<{ center: Point; radius: number; kind?: string }>
  },
): MeshArrays {
  const lift = opts?.lift ?? 0.35
  const defaultColor = opts?.color ?? [0.38, 0.38, 0.40]
  const heightAt = opts?.heightAt
  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []
  const colors: number[] = []

  const colorForKind = (kind?: string): readonly [number, number, number] => {
    if (kind === 'waterfront') return [0.52, 0.50, 0.48]
    if (kind === 'bridge') return [0.50, 0.38, 0.26]
    if (kind === 'arterial') return [0.24, 0.23, 0.22]
    if (kind === 'kerb') return [0.36, 0.28, 0.18]
    if (kind === 'local') return [0.72, 0.58, 0.38]
    return [0.62, 0.50, 0.34]
  }

  for (const stroke of polylines) {
    const strokeColor = colorForKind(stroke.kind)
    const samples = resamplePolyline(stroke.points, Math.max(2.5, stroke.width * 0.45))
    if (samples.length < 2) continue
    const half = stroke.width * 0.5
    const left: Point[] = []
    const right: Point[] = []
    const elevations: Array<{ zL: number; zR: number }> = []

    for (let i = 0; i < samples.length; i++) {
      const prev = samples[Math.max(0, i - 1)]!
      const next = samples[Math.min(samples.length - 1, i + 1)]!
      const n = normalOf(prev, next)
      const p = samples[i]!
      const lp: Point = [p[0] + n[0] * half, p[1] + n[1] * half]
      const rp: Point = [p[0] - n[0] * half, p[1] - n[1] * half]
      left.push(lp)
      right.push(rp)

      const zC = heightAt ? heightAt(p) : 0
      const zL = heightAt ? heightAt(lp) : zC
      const zR = heightAt ? heightAt(rp) : zC
      let baseZ = Math.max(zC, (zL + zR) * 0.5)

      if (stroke.kind === 'bridge') {
        const t = i / (samples.length - 1)
        baseZ += Math.sin(t * Math.PI) * 2.2
      }

      elevations.push({
        zL: baseZ + lift,
        zR: baseZ + lift,
      })
    }

    for (let i = 0; i < samples.length - 1; i++) {
      const a = left[i]!
      const b = right[i]!
      const c = right[i + 1]!
      const d = left[i + 1]!
      const z0 = elevations[i]!
      const z1 = elevations[i + 1]!

      const base = positions.length / 3
      positions.push(a[0], -a[1], z0.zL)
      normals.push(0, 0, 1)
      colors.push(strokeColor[0], strokeColor[1], strokeColor[2])

      positions.push(b[0], -b[1], z0.zR)
      normals.push(0, 0, 1)
      colors.push(strokeColor[0], strokeColor[1], strokeColor[2])

      positions.push(c[0], -c[1], z1.zR)
      normals.push(0, 0, 1)
      colors.push(strokeColor[0], strokeColor[1], strokeColor[2])

      positions.push(d[0], -d[1], z1.zL)
      normals.push(0, 0, 1)
      colors.push(strokeColor[0], strokeColor[1], strokeColor[2])

      indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
  }

  // Seamless Junction Discs to weld all intersecting road ribbons
  if (opts?.junctions) {
    for (const j of opts.junctions) {
      const numSegments = 16
      const jColor = colorForKind(j.kind)
      const zC = (heightAt ? heightAt(j.center) : 0) + lift
      const centerIdx = positions.length / 3
      positions.push(j.center[0], -j.center[1], zC)
      normals.push(0, 0, 1)
      colors.push(jColor[0], jColor[1], jColor[2])

      const startPerimIdx = positions.length / 3
      for (let s = 0; s < numSegments; s++) {
        const angle = (s / numSegments) * Math.PI * 2
        const px = j.center[0] + Math.cos(angle) * j.radius
        const py = j.center[1] + Math.sin(angle) * j.radius
        const zP = (heightAt ? heightAt([px, py]) : 0) + lift
        positions.push(px, -py, zP)
        normals.push(0, 0, 1)
        colors.push(jColor[0], jColor[1], jColor[2])
      }

      for (let s = 0; s < numSegments; s++) {
        const p0 = startPerimIdx + s
        const p1 = startPerimIdx + ((s + 1) % numSegments)
        indices.push(centerIdx, p0, p1)
      }
    }
  }

  return { positions, indices, normals, colors, color: defaultColor, role: opts?.role ?? 'road' }
}
