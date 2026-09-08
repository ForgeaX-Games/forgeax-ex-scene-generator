/**
 * Harbor-city landform.
 * Sparse Coast Control drives the waterfront. River stays on land and
 * meets an open bay — never a closed basin that can cut the continent.
 */
import { defineGenerator } from '@forgeax/project-generator'
import {
  aabbOf,
  asPointList,
  buildHeightGridMesh,
  chaikin,
  closeRing,
  crenulateCoast,
  dist,
  distToPolyline,
  domainWarp,
  fbm,
  fractalMeander,
  hashSeed,
  occupancyRing,
  seaPolygonFromCoast,
  signedCoastDistance,
  lerp,
  lerp3,
  pointInPolygon,
  resamplePolyline,
  ridgedFbm,
  rng,
  sdfCircle,
  smax,
  smin,
  simplifyPolyline,
  smoothstep,
  takeEvery,
  tangentNormal,
  nearestIndex,
  type Point,
} from './lib/geom.generator-lib.ts'

const SAND: readonly [number, number, number] = [0.76, 0.68, 0.48]
const DUNE: readonly [number, number, number] = [0.62, 0.58, 0.36]
const GRASS: readonly [number, number, number] = [0.34, 0.52, 0.24]
const SITE: readonly [number, number, number] = [0.46, 0.58, 0.32]
const HILL: readonly [number, number, number] = [0.40, 0.46, 0.28]
const ROCK: readonly [number, number, number] = [0.58, 0.56, 0.52]
const CLIFF: readonly [number, number, number] = [0.48, 0.47, 0.44]
const SHALLOW: readonly [number, number, number] = [0.18, 0.42, 0.52]
const DEEP: readonly [number, number, number] = [0.08, 0.22, 0.38]
const HARBOR: readonly [number, number, number] = [0.14, 0.40, 0.50]

type Knoll = { center: Point; radius: number; height: number }
type Harbor = { center: Point; radius: number; mouth: Point }
type RiverNet = { main: Point[]; branches: Point[][] }

export const coastalTerrain = defineGenerator({
  id: 'coastal-terrain',
    version: '2.10.0',
    description: 'Solid harbor-town envelope from a shore-distance field, not a self-intersecting offset ribbon.',
  inputs: {
    coastline: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    seaLevel: { type: 'NumberValue', defaultValue: 0, control: true },
    seed: { type: 'NumberValue', defaultValue: 11, control: true },
    width: { type: 'NumberValue', defaultValue: 2000 },
    height: { type: 'NumberValue', defaultValue: 2000 },
    cellSize: { type: 'NumberValue', defaultValue: 8 },
  },
  outputs: {
    heights: { type: 'Any', runtimeType: 'heightfield' },
    heightGrid: { type: 'Grid' },
    mesh: { type: 'Mesh' },
    water: { type: 'Any', runtimeType: 'region-set' },
    buildable: { type: 'Any', runtimeType: 'region-set' },
    citySite: { type: 'Any', runtimeType: 'city-site' },
    cityBoundary: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    creek: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    shoreline: { type: 'Any', runtimeType: 'point2d-list', access: 'list' },
    harbor: { type: 'Any', runtimeType: 'harbor' },
  },
  run(_ctx, args: {
    coastline: Point[]
    seaLevel: number
    seed: number
    width: number
    height: number
    cellSize: number
  }) {
    const coast = asPointList(args.coastline)
    const columns = Math.max(8, Math.round(args.width / args.cellSize))
    const rows = Math.max(8, Math.round(args.height / args.cellSize))
    const cell = args.cellSize
    const random = rng(hashSeed(args.seed, 17))
    const landProbe: Point = [args.width * 0.5, 80]
    const controlSea = seaPolygonFromCoast(coast, args.width, args.height, landProbe)
    const detailShore = buildDetailShore(coast, hashSeed(args.seed, 29))
    const sea = seaPolygonFromCoast(detailShore, args.width, args.height, landProbe)

    const mouthIndex = pickHarborMouth(coast, args.width)
    const controlMouth = coast[mouthIndex] ?? [args.width * 0.5, args.height * 0.82]
    const shoreMouth = nearestIndex(controlMouth, detailShore)
    const mouth = detailShore[shoreMouth] ?? controlMouth
    const harbor: Harbor = { center: mouth, radius: 40, mouth }
    const rivers = buildRiverNetwork(mouth, detailShore, sea, random)
    const knolls = buildKnolls(args.width, random)
    const metres = makeGrid(rows, columns, args.seaLevel)

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        metres[y]![x] = sampleLandform([(x + 0.5) * cell, (y + 0.5) * cell], {
          shore: detailShore,
          sea,
          control: coast,
          controlSea,
          harbor,
          knolls,
          seaLevel: args.seaLevel,
          seed: args.seed,
        })
      }
    }

    const slope = slopeGrid(metres, cell)
    const city = buildHarborCity(detailShore, shoreMouth, sea, {
      mouth,
      creek: rivers.main,
      metres,
      slope,
      cell,
      seed: args.seed,
    })
    city.elevation = pickCoastalPad(metres, cell, city.polygon, detailShore, sea)
    settleCity(metres, cell, city.polygon, detailShore, sea)
    carveRivers(metres, cell, rivers, mouth, detailShore, sea, args.seaLevel)
    clampSea(metres, cell, detailShore, sea, coast, controlSea, args.seaLevel)

    const heightGrid = metres.map((row) => row.map((z) => z / cell))
    const buildableMask = metres.map((row, y) => row.map((z, x) => {
      const p: Point = [(x + 0.5) * cell, (y + 0.5) * cell]
      const wet = z <= args.seaLevel + 0.35 || signedCoastDistance(p, detailShore, sea) < 0
      return wet || (slope[y]?.[x] ?? 0) > 0.18 || z > args.seaLevel + 24 ? 0 : 1
    }))

    const mesh = buildHeightGridMesh(metres, cell, (px, py, z, s) =>
      coastalColor(px, py, z, s, args.seaLevel, detailShore, sea, city.polygon, rivers, harbor, args.seed),
    )

    return {
      heights: {
        columns,
        rows,
        cellSize: cell,
        values: heightGrid,
        role: 'derived',
        lineage: { source: 'coastline' },
      },
      heightGrid,
      mesh,
      water: {
        regions: [{
          key: 'sea',
          kind: 'water',
          polygon: sea,
          role: 'derived',
          lineage: { source: 'coastline' },
        }],
      },
      buildable: {
        regions: [{ key: 'buildable', kind: 'buildable', polygon: city.polygon, mask: buildableMask, role: 'derived' }],
      },
      citySite: {
        ...city,
        creekMouth: mouth,
        harbor,
        role: 'derived',
        lineage: { source: 'coastline', via: ['river', 'harbor'] },
      },
      cityBoundary: city.polygon,
      creek: takeEvery(rivers.main, 12),
      shoreline: detailShore,
      harbor,
    }
  },
})

function makeGrid(rows: number, columns: number, fill: number): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => fill))
}

function buildKnolls(width: number, random: () => number): Knoll[] {
  return Array.from({ length: 12 }, () => ({
    center: [160 + random() * (width - 320), 80 + random() * 900] as Point,
    radius: 70 + random() * 140,
    height: 5 + random() * 11,
  }))
}

function buildDetailShore(coast: readonly Point[], seed: number): Point[] {
  const rounded = chaikin(coast, 3)
  return crenulateCoast(rounded, seed, 14, 1.05)
}

function shoreInlandNormal(shore: readonly Point[], index: number, sea: readonly Point[]): Point {
  const n = tangentNormal(shore, index)
  const p = shore[index]!
  const probe: Point = [p[0] + n[0] * 12, p[1] + n[1] * 12]
  return signedCoastDistance(probe, shore, sea) >= 0 ? n : [-n[0], -n[1]]
}

function alongShoreSpan(shore: readonly Point[], origin: number, halfLength: number): { lo: number; hi: number } {
  let lo = origin
  let acc = 0
  while (lo > 0 && acc < halfLength) {
    acc += dist(shore[lo]!, shore[lo - 1]!)
    lo -= 1
  }
  let hi = origin
  acc = 0
  while (hi < shore.length - 1 && acc < halfLength) {
    acc += dist(shore[hi]!, shore[hi + 1]!)
    hi += 1
  }
  return { lo, hi }
}

function offsetAlongShore(
  shore: readonly Point[],
  sea: readonly Point[],
  lo: number,
  hi: number,
  count: number,
  inland: number,
): Point[] {
  const out: Point[] = []
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1)
    const index = Math.round(lo + (hi - lo) * t)
    const p = shore[index]!
    const n = shoreInlandNormal(shore, index, sea)
    out.push([p[0] + n[0] * inland, p[1] + n[1] * inland])
  }
  return out
}

function boundsOf(polygon: readonly Point[]): { origin: Point; width: number; height: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of polygon) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return {
    origin: [minX, minY],
    width: Math.max(80, maxX - minX),
    height: Math.max(80, maxY - minY),
  }
}

function pickHarborMouth(coast: readonly Point[], width: number): number {
  if (coast.length < 3) return 0
  let best = Math.floor(coast.length / 2)
  let bestScore = -Infinity
  const lo = 1
  const hi = coast.length - 1
  for (let i = lo; i < hi; i++) {
    const p = coast[i]!
    const prev = coast[i - 1]!
    const next = coast[i + 1]!
    const bay = (prev[1] + next[1]) * 0.5 - p[1]
    const central = 1 - Math.abs(p[0] - width * 0.5) / (width * 0.5)
    const score = bay * 0.8 + central * 140
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

/**
 * Solid settlement blob in (along-shore, inland) space.
 * A vertex-offset ribbon of a crenulated coast self-intersects, and even-odd
 * fill then leaves holes in the middle. Rasterizing the distance field and
 * tracing one outer ring keeps the interior filled.
 */
function buildHarborCity(
  shore: readonly Point[],
  mouthIndex: number,
  sea: readonly Point[],
  opts: {
    mouth: Point
    creek: readonly Point[]
    metres: number[][]
    slope: number[][]
    cell: number
    seed: number
  },
): { polygon: Point[]; origin: Point; width: number; height: number; elevation: number } {
  const frontage = 720
  const fade = 110
  const quay = 10
  const depthCore = 720
  const depthFlank = 380
  const riverHalf = 100
  const riverBonus = 70
  const { lo, hi } = alongShoreSpan(shore, mouthIndex, frontage + fade)
  const reach = new Array(shore.length).fill(0)
  const stamps: Point[] = []
  for (let i = lo; i <= hi; i++) {
    const p = shore[i]!
    const n = shoreInlandNormal(shore, i, sea)
    const along = Math.abs(alongFromIndex(shore, mouthIndex, i))
    const taper = 1 - smoothstep(0.52, 1.08, along / frontage)
    const wander = fbm(p[0] / 90, p[1] / 90, opts.seed + 41, 4) * 40
    const probe: Point = [p[0] + n[0] * 180, p[1] + n[1] * 180]
    const riverD = opts.creek.length >= 2 ? distToPolyline(probe, opts.creek) : 1e9
    const alongRiver = (1 - smoothstep(0, riverHalf, riverD)) * riverBonus
    const target = Math.max(quay + 48, depthFlank + (depthCore - depthFlank) * taper + wander + alongRiver)
    reach[i] = inlandReach(p, n, quay, target, shore, sea, opts)
    stamps.push([p[0] + n[0] * quay, p[1] + n[1] * quay])
    stamps.push([p[0] + n[0] * reach[i]!, p[1] + n[1] * reach[i]!])
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = reach.slice()
    for (let i = lo + 1; i < hi; i++) {
      next[i] = reach[i - 1]! * 0.25 + reach[i]! * 0.5 + reach[i + 1]! * 0.25
    }
    for (let i = lo; i <= hi; i++) reach[i] = next[i]!
  }
  const occ = (point: Point): number => {
    const i = nearestIndex(point, shore)
    const along = Math.abs(alongFromIndex(shore, mouthIndex, i))
    const shoreD = signedCoastDistance(point, shore, sea)
    const depth = reach[i] ?? 0
    return Math.min(shoreD - quay, depth - shoreD, frontage + fade - along)
  }
  const raw = occupancyRing(occ, aabbOf(stamps, 24), 16)
  const polygon = raw.length >= 8
    ? simplifyPolyline(chaikin(raw, 2), 12)
    : closeRing([
      ...offsetAlongShore(shore, sea, lo, hi, 18, quay),
      ...offsetAlongShore(shore, sea, hi, lo, 12, depthFlank),
    ])
  return {
    polygon,
    ...boundsOf(polygon),
    elevation: 6.2,
  }
}

function inlandReach(
  origin: Point,
  normal: Point,
  quay: number,
  target: number,
  shore: readonly Point[],
  sea: readonly Point[],
  opts: { metres: number[][]; slope: number[][]; cell: number },
): number {
  let last = quay
  for (let d = quay + 8; d <= target; d += 8) {
    const q: Point = [origin[0] + normal[0] * d, origin[1] + normal[1] * d]
    if (signedCoastDistance(q, shore, sea) < quay) continue
    if (d > 70) {
      const z = sampleGrid(opts.metres, opts.cell, q)
      const s = sampleGrid(opts.slope, opts.cell, q)
      if (z > 22 || s > 0.24) break
    }
    last = d
  }
  return last
}

function alongFromIndex(line: readonly Point[], origin: number, index: number): number {
  if (index === origin) return 0
  let acc = 0
  if (index > origin) {
    for (let i = origin; i < index; i++) acc += dist(line[i]!, line[i + 1]!)
    return acc
  }
  for (let i = origin; i > index; i--) acc += dist(line[i]!, line[i - 1]!)
  return -acc
}

function sampleGrid(grid: number[][], cell: number, point: Point): number {
  const cols = grid[0]?.length ?? 0
  if (!cols) return 0
  const x = Math.max(0, Math.min(cols - 1, Math.floor(point[0] / cell)))
  const y = Math.max(0, Math.min(grid.length - 1, Math.floor(point[1] / cell)))
  return grid[y]![x]!
}

function keepOnLand(
  point: Point,
  shore: readonly Point[],
  sea: readonly Point[],
  minInland: number,
): Point {
  let q: Point = point
  for (let i = 0; i < 8; i++) {
    const d = signedCoastDistance(q, shore, sea)
    if (d >= minInland) return q
    const n = shoreInlandNormal(shore, nearestIndex(q, shore), sea)
    const step = minInland - d + 10
    q = [q[0] + n[0] * step, q[1] + n[1] * step]
  }
  return q
}

function alongPolyline(points: readonly Point[], t: number): Point {
  if (points.length === 0) return [0, 0]
  if (points.length === 1 || t <= 0) return points[0]!
  if (t >= 1) return points[points.length - 1]!
  let total = 0
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1]!, points[i]!)
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

function landMeander(
  start: Point,
  end: Point,
  shore: readonly Point[],
  sea: readonly Point[],
  random: () => number,
  iterations: number,
  minInland: number,
): Point[] {
  const raw = fractalMeander(start, end, random, iterations)
  return raw.map((point, index) => {
    const t = index / Math.max(1, raw.length - 1)
    if (t > 0.9) return point
    return keepOnLand(point, shore, sea, minInland)
  })
}

function buildRiverNetwork(
  mouth: Point,
  shore: readonly Point[],
  sea: readonly Point[],
  random: () => number,
): RiverNet {
  const n = shoreInlandNormal(shore, nearestIndex(mouth, shore), sea)
  const mid = keepOnLand([mouth[0] + n[0] * 220, mouth[1] + n[1] * 220], shore, sea, 48)
  const source = keepOnLand([mid[0] + n[0] * 380, mid[1] + n[1] * 380], shore, sea, 90)
  const via = keepOnLand(lerp(mid, mouth, 0.28), shore, sea, 48)
  const spine = landMeander(source, via, shore, sea, random, 4, 70)
  const lower = landMeander(via, mouth, shore, sea, random, 3, 36)
  const main = resamplePolyline([...spine.slice(0, -1), ...lower], 22)

  const joinA = alongPolyline(main, 0.42)
  const joinB = alongPolyline(main, 0.62)
  const left = keepOnLand([mid[0] - n[1] * 280 + n[0] * 180, mid[1] + n[0] * 280 + n[1] * 180], shore, sea, 70)
  const right = keepOnLand([mid[0] + n[1] * 240 + n[0] * 120, mid[1] - n[0] * 240 + n[1] * 120], shore, sea, 55)
  const branches = [
    resamplePolyline(landMeander(left, joinA, shore, sea, random, 3, 50), 24),
    resamplePolyline(landMeander(right, joinB, shore, sea, random, 3, 40), 24),
  ]
  return { main, branches }
}

function sampleLandform(point: Point, opts: {
  shore: Point[]
  sea: Point[]
  control: Point[]
  controlSea: Point[]
  harbor: Harbor
  knolls: Knoll[]
  seaLevel: number
  seed: number
}): number {
  const rolls = fbm(point[0] / 220, point[1] / 220, opts.seed, 6)
  if (signedCoastDistance(point, opts.control, opts.controlSea) < -90) {
    return opts.seaLevel + Math.max(-6, -90 * 0.04) + rolls * 0.08
  }
  const base = signedCoastDistance(point, opts.shore, opts.sea)
  if (base < 0) {
    return opts.seaLevel + Math.max(-6, base * 0.04) + rolls * 0.08
  }

  let sdf = base
    + fbm(point[0] / 120, point[1] / 120, opts.seed, 4) * 28
    + fbm(point[0] / 40, point[1] / 40, opts.seed + 8, 4) * 10
    + fbm(point[0] / 13, point[1] / 13, opts.seed + 17, 3) * 3
  sdf = smin(sdf, sdfCircle(point, opts.harbor.mouth, opts.harbor.radius), 32)
  if (sdf < 0) {
    return opts.seaLevel + Math.max(-6, sdf * 0.04) + rolls * 0.08
  }

  const [wx, wy] = domainWarp(point[0], point[1], opts.seed + 3, 28, 1 / 280)
  const warped: Point = [wx, wy]
  const knoll = knollField(warped, opts.knolls)
  const ridges = ridgedFbm(wx / 420, wy / 420, opts.seed + 7, 6)
  const micro = fbm(wx / 24, wy / 24, opts.seed + 11, 4)
  const land = smoothstep(0, 16, sdf)
  const profile = composeProfile(sdf)
  const ridgeAmp = smoothstep(140, 680, sdf) * 32
  const rollAmp = 1.2 + smoothstep(40, 500, sdf) * 7
  return opts.seaLevel
    + profile
    + rolls * rollAmp * land
    + ridges * ridgeAmp
    + knoll
    + micro * (0.4 + land * 0.7)
}

function composeProfile(d: number): number {
  const beach = smoothstep(0, 70, d) * (1 - smoothstep(30, 120, d)) * 2.8
  const dune = Math.exp(-((d - 80) ** 2) / (2 * 40 * 40)) * 5.5
  const terrace = smoothstep(50, 190, d) * (1 - smoothstep(280, 480, d)) * 7
  const foothill = smoothstep(180, 540, d) * 24
  const massif = smoothstep(320, 1100, d) * 38
  return beach + dune + terrace + foothill + massif
}

function knollField(point: Point, knolls: readonly Knoll[]): number {
  let field = 0
  for (const knoll of knolls) {
    const sdf = sdfCircle(point, knoll.center, knoll.radius)
    const bump = Math.max(0, 1 - (Math.max(0, sdf + knoll.radius) / knoll.radius) ** 2) * knoll.height
    field = smax(field, bump, 1.8)
  }
  return field
}

function slopeGrid(metres: number[][], cell: number): number[][] {
  const rows = metres.length
  const cols = metres[0]?.length ?? 0
  const at = (x: number, y: number): number =>
    metres[Math.max(0, Math.min(rows - 1, y))]![Math.max(0, Math.min(cols - 1, x))]!
  return metres.map((_, y) => metres[0]!.map((__, x) => Math.hypot(
    (at(x + 1, y) - at(x - 1, y)) / (2 * cell),
    (at(x, y + 1) - at(x, y - 1)) / (2 * cell),
  )))
}

function pickCoastalPad(
  grid: number[][],
  cell: number,
  polygon: readonly Point[],
  shore: readonly Point[],
  sea: readonly Point[],
): number {
  const samples: number[] = []
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  for (let y = 0; y < rows; y += 2) {
    for (let x = 0; x < cols; x += 2) {
      const p: Point = [(x + 0.5) * cell, (y + 0.5) * cell]
      if (!pointInPolygon(p, polygon)) continue
      const inland = signedCoastDistance(p, shore, sea)
      if (inland < 28 || inland > 150) continue
      samples.push(grid[y]![x]!)
    }
  }
  if (samples.length < 4) return 6.2
  samples.sort((a, b) => a - b)
  return Math.max(3.5, Math.min(12, samples[Math.floor(samples.length * 0.45)]!))
}

function settleCity(
  grid: number[][],
  cell: number,
  polygon: readonly Point[],
  shore: readonly Point[],
  sea: readonly Point[],
): void {
  if (polygon.length < 3) return
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const p: Point = [(x + 0.5) * cell, (y + 0.5) * cell]
      if (!pointInPolygon(p, polygon)) continue
      const inland = signedCoastDistance(p, shore, sea)
      if (inland < 16) continue
      const existing = grid[y]![x]!
      if (existing <= 16) continue
      const shave = (1 - smoothstep(16, 28, existing)) * 0.22
      if (shave <= 0.01) continue
      grid[y]![x] = existing * (1 - shave) + 12 * shave
    }
  }
}

function carveRivers(
  grid: number[][],
  cell: number,
  rivers: RiverNet,
  mouth: Point,
  shore: readonly Point[],
  sea: readonly Point[],
  seaLevel: number,
): void {
  const channels = [
    { points: rivers.main, minW: 7, maxW: 26, depth: 3.4 },
    ...rivers.branches.map((points) => ({ points, minW: 4, maxW: 11, depth: 1.8 })),
  ]
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const p: Point = [(x + 0.5) * cell, (y + 0.5) * cell]
      const inland = signedCoastDistance(p, shore, sea)
      if (inland < -12) continue
      let best = 0
      let cut = 0
      for (const channel of channels) {
        if (channel.points.length < 2) continue
        const d = distToPolyline(p, channel.points)
        const along = 1 - Math.min(1, dist(p, mouth) / Math.max(80, dist(channel.points[0]!, mouth)))
        const estuary = 1 - smoothstep(0, 90, dist(p, mouth))
        const width = channel.minW + along * (channel.maxW - channel.minW) + estuary * (channel === channels[0] ? 34 : 8)
        const carve = Math.max(0, 1 - smoothstep(0, width, d))
        if (carve <= 0) continue
        const depth = (channel.depth + along * 1.6) * carve ** 1.15
        if (depth > cut) {
          cut = depth
          best = along
        }
      }
      if (cut <= 0) continue
      const estuary = 1 - smoothstep(0, 70, dist(p, mouth))
      const floor = seaLevel + (1 - estuary) * 0.25
      const next = grid[y]![x]! - cut * (0.75 + best * 0.4)
      grid[y]![x] = Math.max(floor, next)
    }
  }
}

function clampSea(
  grid: number[][],
  cell: number,
  shore: readonly Point[],
  sea: readonly Point[],
  control: readonly Point[],
  controlSea: readonly Point[],
  seaLevel: number,
): void {
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const p: Point = [(x + 0.5) * cell, (y + 0.5) * cell]
      const wet = signedCoastDistance(p, shore, sea) < 0
        || signedCoastDistance(p, control, controlSea) < -90
      if (!wet) continue
      if (grid[y]![x]! > seaLevel + 0.2) grid[y]![x] = seaLevel + 0.05
    }
  }
}

function coastalColor(
  px: number,
  py: number,
  z: number,
  slope: number,
  seaLevel: number,
  coast: readonly Point[],
  sea: readonly Point[],
  site: readonly Point[],
  rivers: RiverNet,
  harbor: Harbor,
  seed: number,
): readonly [number, number, number] {
  const inland = signedCoastDistance([px, py], coast, sea)
  const grain = 0.5 + 0.5 * fbm(px / 28, py / 28, seed + 90, 3)
  const riverDist = Math.min(
    distToPolyline([px, py], rivers.main),
    ...rivers.branches.map((branch) => distToPolyline([px, py], branch)),
  )
  if (inland < 0 || z < seaLevel + 0.12) {
    const nearBay = 1 - smoothstep(0, 70, dist([px, py], harbor.mouth))
    return lerp3(lerp3(SHALLOW, HARBOR, nearBay), DEEP, Math.min(1, Math.max(0, (seaLevel - z) / 10)))
  }
  const sandAmt = (1 - smoothstep(12, 90, inland)) * (1 - smoothstep(seaLevel + 3, seaLevel + 8, z))
  const siteAmt = pointInPolygon([px, py], site) ? 0.55 : (1 - smoothstep(0, 36, distToPolyline([px, py], site))) * 0.28
  const moist = 1 - smoothstep(6, 34, riverDist)
  let rgb = lerp3(GRASS, HILL, smoothstep(seaLevel + 6, seaLevel + 16, z))
  rgb = lerp3(rgb, SAND, sandAmt * 0.9)
  rgb = lerp3(rgb, SITE, siteAmt)
  rgb = lerp3(rgb, SHALLOW, moist * 0.38)
  rgb = lerp3(rgb, ROCK, smoothstep(seaLevel + 16, seaLevel + 34, z) * 0.7)
  rgb = lerp3(rgb, CLIFF, smoothstep(0.12, 0.34, slope) * 0.55)
  return lerp3(rgb, [rgb[0] * 0.92, rgb[1] * 0.94, rgb[2] * 0.9], 1 - grain * 0.3)
}
