/**
 * Procedural 3A White-Box Scene Structures for Alpine Valley Village:
 *   - buildStoneArchBridgeMesh: Spanning arch bridge with deck, parapets & guard piers
 *   - buildLandmarkWatchtowerMesh: Multi-tiered village bell tower / watchtower with bartizans & spire
 *   - buildWatermillMesh: Riverfront milling house with 12-spoke waterwheel & sluice flume
 *   - buildVillagePlazaMesh: Paved central marketplace slab with fountain monument & stone curbs
 *   - buildRetainingWallsMesh: Stone retaining walls along terrace risers
 *   - buildPineTreesMesh: Low-poly procedural white-box pine trees with trunks & layered foliage
 *   - buildMultiTierHousesMesh: Cottages, 2-story townhouses with overhangs, barns & cabins with roofs & chimneys
 */

import type { SceneMesh } from './content.js'
import { civicPadHeight, drapeSurfaceZ, sampleHeightfieldSurface, unwrapHeightGrid } from './heightfield.js'
import { dedupeControlPoints, sampleOpenSpline } from './spline.js'
import { buildRoadNetworkMesh } from './sweep.js'

type Vec2 = { x: number; y: number }

export const VILLAGE_RING_ROAD_OFFSET = 2.6

export const STONE_BRIDGE_COLOR: readonly [number, number, number] = [0.82, 0.79, 0.74]
export const STONE_ARCH_COLOR: readonly [number, number, number] = [0.72, 0.68, 0.62]
export const WATCHTOWER_STONE_COLOR: readonly [number, number, number] = [0.88, 0.86, 0.82]
export const WATCHTOWER_ROOF_COLOR: readonly [number, number, number] = [0.65, 0.38, 0.30]
export const WATCHTOWER_BALCONY_COLOR: readonly [number, number, number] = [0.55, 0.44, 0.34]
export const WATERMILL_COLOR: readonly [number, number, number] = [0.85, 0.82, 0.76]
export const WATERMILL_ROOF_COLOR: readonly [number, number, number] = [0.62, 0.44, 0.34]
export const WATERMILL_WHEEL_COLOR: readonly [number, number, number] = [0.46, 0.36, 0.26]
export const PLAZA_COLOR: readonly [number, number, number] = [0.82, 0.78, 0.70]
export const PLAZA_MONUMENT_COLOR: readonly [number, number, number] = [0.68, 0.65, 0.60]
export const RETAINING_WALL_COLOR: readonly [number, number, number] = [0.68, 0.65, 0.58]
export const PINE_FOLIAGE_COLOR: readonly [number, number, number] = [0.22, 0.42, 0.22]
export const PINE_TRUNK_COLOR: readonly [number, number, number] = [0.48, 0.38, 0.28]
export const HOUSE_WALL_COLOR: readonly [number, number, number] = [0.92, 0.90, 0.85]
export const HOUSE_BASE_COLOR: readonly [number, number, number] = [0.72, 0.68, 0.62]
export const HOUSE_TIMBER_COLOR: readonly [number, number, number] = [0.55, 0.44, 0.34]
export const HOUSE_ROOF_COLOR: readonly [number, number, number] = [0.68, 0.40, 0.32]
export const HOUSE_CHIMNEY_COLOR: readonly [number, number, number] = [0.62, 0.58, 0.54]
export const RIVER_WATER_COLOR: readonly [number, number, number] = [0.22, 0.54, 0.82]

export const MARKET_CANOPY_RED: readonly [number, number, number] = [0.85, 0.32, 0.28]
export const MARKET_CANOPY_BLUE: readonly [number, number, number] = [0.28, 0.48, 0.78]
export const MARKET_CANOPY_GOLD: readonly [number, number, number] = [0.88, 0.72, 0.32]
export const MARKET_CANOPY_STRIPE: readonly [number, number, number] = [0.94, 0.92, 0.86]
export const WOOD_BARREL_COLOR: readonly [number, number, number] = [0.52, 0.38, 0.26]
export const WOOD_CRATE_COLOR: readonly [number, number, number] = [0.68, 0.54, 0.38]
export const WOOD_PLANK_COLOR: readonly [number, number, number] = [0.62, 0.48, 0.34]
export const IRON_LANTERN_COLOR: readonly [number, number, number] = [0.22, 0.22, 0.24]
export const LANTERN_GLOW_COLOR: readonly [number, number, number] = [0.98, 0.88, 0.45]
export const MOUNTAIN_CROSS_COLOR: readonly [number, number, number] = [0.58, 0.46, 0.36]
export const MOUNTAIN_CAIRN_COLOR: readonly [number, number, number] = [0.70, 0.67, 0.62]
export const BOULDER_ROCK_COLOR: readonly [number, number, number] = [0.58, 0.56, 0.52]
export const HAYSTACK_COLOR: readonly [number, number, number] = [0.78, 0.70, 0.38]
export const RUSTIC_FENCE_COLOR: readonly [number, number, number] = [0.52, 0.42, 0.32]
export const QUAY_STONE_COLOR: readonly [number, number, number] = [0.76, 0.72, 0.66]
export const FOUNTAIN_WATER_COLOR: readonly [number, number, number] = [0.28, 0.62, 0.88]
export const REFUGE_STONE_COLOR: readonly [number, number, number] = [0.65, 0.62, 0.58]
export const REFUGE_ROOF_COLOR: readonly [number, number, number] = [0.42, 0.40, 0.38]

function surfaceZ(heightGrid: unknown, x: number, y: number, cellSize = 1): number {
  return sampleHeightfieldSurface(heightGrid, x / cellSize, y / cellSize) * cellSize
}

/** Helper to push a quad face with computed normal and optional vertex color */
function pushQuad(
  positions: number[],
  indices: number[],
  normals: number[],
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number],
  customNormal?: [number, number, number],
  colors?: number[],
  color?: readonly [number, number, number],
) {
  let nx: number, ny: number, nz: number
  if (customNormal) {
    nx = customNormal[0]; ny = customNormal[1]; nz = customNormal[2]
  } else {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2]
    const vx = p3[0] - p0[0], vy = p3[1] - p0[1], vz = p3[2] - p0[2]
    nx = uy * vz - uz * vy
    ny = uz * vx - ux * vz
    nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len
  }
  const base = positions.length / 3
  positions.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2])
  normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz)
  if (colors && color) {
    colors.push(color[0], color[1], color[2], color[0], color[1], color[2], color[0], color[1], color[2], color[0], color[1], color[2])
  }
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

/** Helper to push a triangle face with computed normal and optional vertex color */
function pushTri(
  positions: number[],
  indices: number[],
  normals: number[],
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  customNormal?: [number, number, number],
  colors?: number[],
  color?: readonly [number, number, number],
) {
  let nx: number, ny: number, nz: number
  if (customNormal) {
    nx = customNormal[0]; ny = customNormal[1]; nz = customNormal[2]
  } else {
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2]
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2]
    nx = uy * vz - uz * vy
    ny = uz * vx - ux * vz
    nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    nx /= len; ny /= len; nz /= len
  }
  const base = positions.length / 3
  positions.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2])
  normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz)
  if (colors && color) {
    colors.push(color[0], color[1], color[2], color[0], color[1], color[2], color[0], color[1], color[2])
  }
  indices.push(base, base + 1, base + 2)
}

/** Helper to push an oriented 3D box with colors and normals */
function pushRotBox(
  positions: number[],
  indices: number[],
  normals: number[],
  colors: number[],
  cx: number, cy: number, cz: number,
  w: number, d: number, h: number,
  yaw: number,
  color: readonly [number, number, number],
  cellSize = 1,
) {
  const hw = w * 0.5, hd = d * 0.5, hh = h * 0.5
  const cos = Math.cos(-yaw), sin = Math.sin(-yaw)
  const rot = (lx: number, ly: number, lz: number): [number, number, number] => [
    (cx + lx * cos - ly * sin) * cellSize,
    -(cy + lx * sin + ly * cos) * cellSize,
    cz + lz,
  ]
  const p0 = rot(-hw, -hd, -hh)
  const p1 = rot( hw, -hd, -hh)
  const p2 = rot( hw,  hd, -hh)
  const p3 = rot(-hw,  hd, -hh)
  const t0 = rot(-hw, -hd,  hh)
  const t1 = rot( hw, -hd,  hh)
  const t2 = rot( hw,  hd,  hh)
  const t3 = rot(-hw,  hd,  hh)

  pushQuad(positions, indices, normals, p0, p1, t1, t0, undefined, colors, color)
  pushQuad(positions, indices, normals, p1, p2, t2, t1, undefined, colors, color)
  pushQuad(positions, indices, normals, p2, p3, t3, t2, undefined, colors, color)
  pushQuad(positions, indices, normals, p3, p0, t0, t3, undefined, colors, color)
  pushQuad(positions, indices, normals, t0, t1, t2, t3, [0, 0, 1], colors, color)
  pushQuad(positions, indices, normals, p3, p2, p1, p0, [0, 0, -1], colors, color)
}

/** Helper to push a vertical cylinder / tapered cone with colors and normals */
function pushCylinder(
  positions: number[],
  indices: number[],
  normals: number[],
  colors: number[],
  cx: number, cy: number,
  z0: number, z1: number,
  r0: number, r1: number,
  segs: number,
  color: readonly [number, number, number],
  cellSize = 1,
) {
  const bRing: Array<[number, number, number]> = []
  const tRing: Array<[number, number, number]> = []
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2
    bRing.push([(cx + Math.cos(a) * r0) * cellSize, -(cy + Math.sin(a) * r0) * cellSize, z0])
    tRing.push([(cx + Math.cos(a) * r1) * cellSize, -(cy + Math.sin(a) * r1) * cellSize, z1])
  }
  for (let i = 0; i < segs; i++) {
    const next = (i + 1) % segs
    pushQuad(positions, indices, normals, bRing[i]!, bRing[next]!, tRing[next]!, tRing[i]!, undefined, colors, color)
  }
  const cTop: [number, number, number] = [cx * cellSize, -cy * cellSize, z1]
  const cBot: [number, number, number] = [cx * cellSize, -cy * cellSize, z0]
  for (let i = 0; i < segs; i++) {
    const next = (i + 1) % segs
    pushTri(positions, indices, normals, cTop, tRing[i]!, tRing[next]!, [0, 0, 1], colors, color)
    pushTri(positions, indices, normals, cBot, bRing[next]!, bRing[i]!, [0, 0, -1], colors, color)
  }
}

// ─── 1. STONE ARCH BRIDGE ───────────────────────────────────────────────────

export interface StoneArchBridgeOpts {
  readonly start: [number, number]
  readonly end: [number, number]
  readonly heightGrid?: unknown
  readonly width?: number
  readonly archHeight?: number
  readonly parapetHeight?: number
  readonly segments?: number
  readonly cellSize?: number
}

export function buildStoneArchBridgeMesh(opts: StoneArchBridgeOpts): SceneMesh | null {
  const [x0, y0] = opts.start
  const [x1, y1] = opts.end
  const width = opts.width ?? 3.8
  const archH = opts.archHeight ?? 1.8
  const parapetH = opts.parapetHeight ?? 0.85
  const segs = opts.segments ?? 14
  const cellSize = opts.cellSize ?? 1

  const dx = x1 - x0
  const dy = y1 - y0
  const span = Math.hypot(dx, dy)
  if (span < 1.0) return null

  const dirX = dx / span
  const dirY = dy / span
  const normX = -dirY
  const normY = dirX

  const z0 = surfaceZ(opts.heightGrid, x0, y0, cellSize) + 0.3
  const z1 = surfaceZ(opts.heightGrid, x1, y1, cellSize) + 0.3
  const zRiver = Math.min(
    surfaceZ(opts.heightGrid, (x0 + x1) * 0.5, (y0 + y1) * 0.5, cellSize),
    Math.min(z0, z1) - 1.2,
  )

  const halfW = width * 0.5
  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []
  const colors: number[] = []

  // Generate deck and arch profile points along the span
  const deckLeft: Array<[number, number, number]> = []
  const deckRight: Array<[number, number, number]> = []
  const archLeft: Array<[number, number, number]> = []
  const archRight: Array<[number, number, number]> = []
  const parapetTopL: Array<[number, number, number]> = []
  const parapetTopR: Array<[number, number, number]> = []

  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    const px = x0 + dirX * span * t
    const py = y0 + dirY * span * t

    const crown = Math.sin(t * Math.PI) * 0.42
    const zDeck = z0 * (1 - t) + z1 * t + crown

    const archCurve = Math.sin(t * Math.PI)
    const zArch = Math.min(zDeck - 0.5, zRiver + archCurve * archH)

    const lx = px + normX * halfW
    const ly = py + normY * halfW
    const rx = px - normX * halfW
    const ry = py - normY * halfW

    deckLeft.push([lx * cellSize, -ly * cellSize, zDeck])
    deckRight.push([rx * cellSize, -ry * cellSize, zDeck])
    archLeft.push([lx * cellSize, -ly * cellSize, zArch])
    archRight.push([rx * cellSize, -ry * cellSize, zArch])

    parapetTopL.push([lx * cellSize, -ly * cellSize, zDeck + parapetH])
    parapetTopR.push([rx * cellSize, -ry * cellSize, zDeck + parapetH])
  }

  // 1. Deck Pavement (Road Surface)
  for (let i = 0; i < segs; i++) {
    pushQuad(positions, indices, normals, deckLeft[i]!, deckRight[i]!, deckRight[i + 1]!, deckLeft[i + 1]!, [0, 0, 1], colors, STONE_BRIDGE_COLOR)
  }

  // 2. Arch Underside (Soffit)
  for (let i = 0; i < segs; i++) {
    pushQuad(positions, indices, normals, archLeft[i]!, archLeft[i + 1]!, archRight[i + 1]!, archRight[i]!, [0, 0, -1], colors, STONE_ARCH_COLOR)
  }

  // 3. Spandrel Walls (Left and Right Flanks)
  for (let i = 0; i < segs; i++) {
    pushQuad(positions, indices, normals, archLeft[i]!, deckLeft[i]!, deckLeft[i + 1]!, archLeft[i + 1]!, [normX, -normY, 0], colors, STONE_ARCH_COLOR)
    pushQuad(positions, indices, normals, deckRight[i]!, archRight[i]!, archRight[i + 1]!, deckRight[i + 1]!, [-normX, normY, 0], colors, STONE_ARCH_COLOR)
  }

  // 4. Parapet Railings (Left & Right)
  for (let i = 0; i < segs; i++) {
    pushQuad(positions, indices, normals, deckLeft[i]!, parapetTopL[i]!, parapetTopL[i + 1]!, deckLeft[i + 1]!, [normX, -normY, 0], colors, STONE_BRIDGE_COLOR)
    pushQuad(positions, indices, normals, parapetTopR[i]!, deckRight[i]!, deckRight[i + 1]!, parapetTopR[i + 1]!, [-normX, normY, 0], colors, STONE_BRIDGE_COLOR)
  }

  // 5. Flared Approach Ramps and Parapets (Anchor into Ground Roads)
  const rampLen = 2.4
  const flareW = halfW + 0.65
  const rampEnds: Array<{ baseP: [number, number]; sign: number; zDeck: number }> = [
    { baseP: [x0, y0], sign: -1, zDeck: z0 },
    { baseP: [x1, y1], sign: 1, zDeck: z1 },
  ]
  for (const { baseP, sign, zDeck } of rampEnds) {
    const rx = baseP[0] + dirX * sign * rampLen
    const ry = baseP[1] + dirY * sign * rampLen
    const zG = surfaceZ(opts.heightGrid, rx, ry, cellSize)
    const pL: [number, number, number] = [(rx + normX * flareW) * cellSize, -(ry + normY * flareW) * cellSize, zG]
    const pR: [number, number, number] = [(rx - normX * flareW) * cellSize, -(ry - normY * flareW) * cellSize, zG]
    const bL = sign === -1 ? deckLeft[0]! : deckLeft[segs]!
    const bR = sign === -1 ? deckRight[0]! : deckRight[segs]!
    pushQuad(positions, indices, normals, bL, bR, pR, pL, [0, 0, 1], colors, STONE_BRIDGE_COLOR)

    // Flared approach stone parapet wings
    const ptL: [number, number, number] = [pL[0], pL[1], zG + parapetH * 0.75]
    const ptR: [number, number, number] = [pR[0], pR[1], zG + parapetH * 0.75]
    const topL = sign === -1 ? parapetTopL[0]! : parapetTopL[segs]!
    const topR = sign === -1 ? parapetTopR[0]! : parapetTopR[segs]!
    pushQuad(positions, indices, normals, bL, topL, ptL, pL, [normX, -normY, 0], colors, STONE_BRIDGE_COLOR)
    pushQuad(positions, indices, normals, pR, ptR, topR, bR, [-normX, normY, 0], colors, STONE_BRIDGE_COLOR)
  }

  // 6. Abutment End Walls & Riverbank Wing Retaining Walls
  const zFloor0 = surfaceZ(opts.heightGrid, x0, y0, cellSize) - 1.2
  const zFloor1 = surfaceZ(opts.heightGrid, x1, y1, cellSize) - 1.2
  const a0L: [number, number, number] = [deckLeft[0]![0], deckLeft[0]![1], zFloor0]
  const a0R: [number, number, number] = [deckRight[0]![0], deckRight[0]![1], zFloor0]
  const a1L: [number, number, number] = [deckLeft[segs]![0], deckLeft[segs]![1], zFloor1]
  const a1R: [number, number, number] = [deckRight[segs]![0], deckRight[segs]![1], zFloor1]

  pushQuad(positions, indices, normals, a0R, a0L, deckLeft[0]!, deckRight[0]!, [-dirX, dirY, 0], colors, STONE_ARCH_COLOR)
  pushQuad(positions, indices, normals, a1L, a1R, deckRight[segs]!, deckLeft[segs]!, [dirX, -dirY, 0], colors, STONE_ARCH_COLOR)

  // 7. Corner Entrance Guard Pylons with Lantern Caps (4 Stone Pillars with Lanterns)
  const pierW = 0.62
  const pierH = parapetH + 0.55
  const corners = [deckLeft[0]!, deckRight[0]!, deckLeft[segs]!, deckRight[segs]!]
  for (const c of corners) {
    const pz = c[2]
    pushRotBox(positions, indices, normals, colors, c[0] / cellSize, -c[1] / cellSize, pz + pierH * 0.5, pierW, pierW, pierH, 0, STONE_BRIDGE_COLOR, cellSize)
    // Pyramid stone capstone
    const capApex: [number, number, number] = [c[0], c[1], pz + pierH + 0.35]
    const cap0: [number, number, number] = [c[0] - pierW * 0.55, c[1] - pierW * 0.55, pz + pierH]
    const cap1: [number, number, number] = [c[0] + pierW * 0.55, c[1] - pierW * 0.55, pz + pierH]
    const cap2: [number, number, number] = [c[0] + pierW * 0.55, c[1] + pierW * 0.55, pz + pierH]
    const cap3: [number, number, number] = [c[0] - pierW * 0.55, c[1] + pierW * 0.55, pz + pierH]
    pushTri(positions, indices, normals, cap0, cap1, capApex, undefined, colors, STONE_ARCH_COLOR)
    pushTri(positions, indices, normals, cap1, cap2, capApex, undefined, colors, STONE_ARCH_COLOR)
    pushTri(positions, indices, normals, cap2, cap3, capApex, undefined, colors, STONE_ARCH_COLOR)
    pushTri(positions, indices, normals, cap3, cap0, capApex, undefined, colors, STONE_ARCH_COLOR)

    // Wrought Iron Lantern on top of pylon
    const lZ = pz + pierH + 0.55
    pushRotBox(positions, indices, normals, colors, c[0] / cellSize, -c[1] / cellSize, lZ, 0.28, 0.28, 0.35, 0, IRON_LANTERN_COLOR, cellSize)
    pushRotBox(positions, indices, normals, colors, c[0] / cellSize, -c[1] / cellSize, lZ, 0.20, 0.20, 0.25, 0, LANTERN_GLOW_COLOR, cellSize)
  }

  return {
    positions,
    indices,
    normals,
    colors,
    color: [...STONE_BRIDGE_COLOR],
    role: 'road',
  }
}

// ─── 2. LANDMARK WATCHTOWER / BELL TOWER ─────────────────────────────────────

export interface LandmarkWatchtowerOpts {
  readonly position: [number, number]
  readonly heightGrid?: unknown
  readonly baseSize?: number
  readonly height?: number
  readonly yaw?: number
  readonly cellSize?: number
}

export function buildLandmarkWatchtowerMesh(opts: LandmarkWatchtowerOpts): SceneMesh | null {
  const [cx, cy] = opts.position
  const baseSize = opts.baseSize ?? 4.4
  const totalH = opts.height ?? 14.5
  const yaw = opts.yaw ?? 0
  const cellSize = opts.cellSize ?? 1

  const zBase = surfaceZ(opts.heightGrid, cx, cy, cellSize)
  const cos = Math.cos(-yaw)
  const sin = Math.sin(-yaw)

  const rot = (lx: number, ly: number, z: number): [number, number, number] => [
    (cx + lx * cos - ly * sin) * cellSize,
    -(cy + lx * sin + ly * cos) * cellSize,
    z,
  ]

  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []
  const colors: number[] = []

  const halfB = baseSize * 0.5
  const halfShaft = baseSize * 0.42
  const halfBalcony = baseSize * 0.54
  const halfSpire = baseSize * 0.46

  const hPlinth = zBase + 2.5
  const hShaft = zBase + totalH * 0.68
  const hCorbel = hShaft + 0.4
  const hBelfry = zBase + totalH * 0.82
  const hSpire = zBase + totalH

  function pushTier(
    r0: number, r1: number, z0: number, z1: number,
    tierColor: readonly [number, number, number],
  ) {
    const b0 = rot(-r0, -r0, z0)
    const b1 = rot(r0, -r0, z0)
    const b2 = rot(r0, r0, z0)
    const b3 = rot(-r0, r0, z0)
    const t0 = rot(-r1, -r1, z1)
    const t1 = rot(r1, -r1, z1)
    const t2 = rot(r1, r1, z1)
    const t3 = rot(-r1, r1, z1)

    pushQuad(positions, indices, normals, b0, b1, t1, t0, undefined, colors, tierColor)
    pushQuad(positions, indices, normals, b1, b2, t2, t1, undefined, colors, tierColor)
    pushQuad(positions, indices, normals, b2, b3, t3, t2, undefined, colors, tierColor)
    pushQuad(positions, indices, normals, b3, b0, t0, t3, undefined, colors, tierColor)
  }

  // Tier 1: Plinth (battered foundation)
  pushTier(halfB, halfShaft, zBase - 0.5, hPlinth, WATCHTOWER_STONE_COLOR)

  // Tier 2: Tower Shaft with slight taper
  pushTier(halfShaft, halfShaft * 0.94, hPlinth, hShaft, WATCHTOWER_STONE_COLOR)

  // Corbelled Bracket support under belfry
  pushTier(halfShaft * 0.94, halfBalcony, hShaft, hCorbel, WATCHTOWER_BALCONY_COLOR)

  // Tier 3: Cantilevered Belfry gallery with arched openings
  pushTier(halfBalcony, halfBalcony, hCorbel, hBelfry, WATCHTOWER_STONE_COLOR)

  // Belfry corner bartizan turrets (4 decorative corner spires)
  const turretR = 0.35
  const turretH = 1.2
  const turretOffsets: Array<[number, number]> = [
    [-halfBalcony, -halfBalcony],
    [halfBalcony, -halfBalcony],
    [halfBalcony, halfBalcony],
    [-halfBalcony, halfBalcony],
  ]
  for (const [tx, ty] of turretOffsets) {
    const tb0 = rot(tx - turretR, ty - turretR, hBelfry)
    const tb1 = rot(tx + turretR, ty - turretR, hBelfry)
    const tb2 = rot(tx + turretR, ty + turretR, hBelfry)
    const tb3 = rot(tx - turretR, ty + turretR, hBelfry)
    const tt0 = rot(tx - turretR, ty - turretR, hBelfry + turretH)
    const tt1 = rot(tx + turretR, ty - turretR, hBelfry + turretH)
    const tt2 = rot(tx + turretR, ty + turretR, hBelfry + turretH)
    const tt3 = rot(tx - turretR, ty + turretR, hBelfry + turretH)

    pushQuad(positions, indices, normals, tb0, tb1, tt1, tt0, undefined, colors, WATCHTOWER_STONE_COLOR)
    pushQuad(positions, indices, normals, tb1, tb2, tt2, tt1, undefined, colors, WATCHTOWER_STONE_COLOR)
    pushQuad(positions, indices, normals, tb2, tb3, tt3, tt2, undefined, colors, WATCHTOWER_STONE_COLOR)
    pushQuad(positions, indices, normals, tb3, tb0, tt0, tt3, undefined, colors, WATCHTOWER_STONE_COLOR)

    const tApex = rot(tx, ty, hBelfry + turretH + 0.5)
    pushTri(positions, indices, normals, tt0, tt1, tApex, undefined, colors, WATCHTOWER_ROOF_COLOR)
    pushTri(positions, indices, normals, tt1, tt2, tApex, undefined, colors, WATCHTOWER_ROOF_COLOR)
    pushTri(positions, indices, normals, tt2, tt3, tApex, undefined, colors, WATCHTOWER_ROOF_COLOR)
    pushTri(positions, indices, normals, tt3, tt0, tApex, undefined, colors, WATCHTOWER_ROOF_COLOR)
  }

  // Tier 4: Steep Spire Roof (4-sided pyramid)
  const sp0 = rot(-halfSpire, -halfSpire, hBelfry)
  const sp1 = rot(halfSpire, -halfSpire, hBelfry)
  const sp2 = rot(halfSpire, halfSpire, hBelfry)
  const sp3 = rot(-halfSpire, halfSpire, hBelfry)
  const apex = rot(0, 0, hSpire)

  pushTri(positions, indices, normals, sp0, sp1, apex, undefined, colors, WATCHTOWER_ROOF_COLOR)
  pushTri(positions, indices, normals, sp1, sp2, apex, undefined, colors, WATCHTOWER_ROOF_COLOR)
  pushTri(positions, indices, normals, sp2, sp3, apex, undefined, colors, WATCHTOWER_ROOF_COLOR)
  pushTri(positions, indices, normals, sp3, sp0, apex, undefined, colors, WATCHTOWER_ROOF_COLOR)

  return {
    positions,
    indices,
    normals,
    colors,
    color: [...WATCHTOWER_STONE_COLOR],
    role: 'houses',
  }
}

// ─── 3. RIVERFRONT WATERMILL WITH 12-SPOKE WATERWHEEL ───────────────────────

export interface WatermillOpts {
  readonly position: [number, number]
  readonly heightGrid?: unknown
  readonly yaw?: number
  readonly cellSize?: number
}

export function buildWatermillMesh(opts: WatermillOpts): SceneMesh | null {
  const [cx, cy] = opts.position
  const yaw = opts.yaw ?? 0
  const cellSize = opts.cellSize ?? 1

  const zBase = surfaceZ(opts.heightGrid, cx, cy, cellSize)
  const cos = Math.cos(-yaw)
  const sin = Math.sin(-yaw)

  const rot = (lx: number, ly: number, z: number): [number, number, number] => [
    (cx + lx * cos - ly * sin) * cellSize,
    -(cy + lx * sin + ly * cos) * cellSize,
    z,
  ]

  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []
  const colors: number[] = []

  // 1. Mill Main Building
  const w = 5.2, d = 4.2, wallH = 3.2, roofH = 2.2
  const halfW = w * 0.5, halfD = d * 0.5

  const zFL = surfaceZ(opts.heightGrid, cx - halfW, cy - halfD, cellSize) - 0.5
  const zFR = surfaceZ(opts.heightGrid, cx + halfW, cy - halfD, cellSize) - 0.5
  const zBR = surfaceZ(opts.heightGrid, cx + halfW, cy + halfD, cellSize) - 0.5
  const zBL = surfaceZ(opts.heightGrid, cx - halfW, cy + halfD, cellSize) - 0.5

  const topZ = zBase + wallH
  const ridgeZ = topZ + roofH

  const b0 = rot(-halfW, -halfD, zFL)
  const b1 = rot(halfW, -halfD, zFR)
  const b2 = rot(halfW, halfD, zBR)
  const b3 = rot(-halfW, halfD, zBL)

  const t0 = rot(-halfW, -halfD, topZ)
  const t1 = rot(halfW, -halfD, topZ)
  const t2 = rot(halfW, halfD, topZ)
  const t3 = rot(-halfW, halfD, topZ)

  // Stone walls
  pushQuad(positions, indices, normals, b0, b1, t1, t0, undefined, colors, WATERMILL_COLOR)
  pushQuad(positions, indices, normals, b1, b2, t2, t1, undefined, colors, WATERMILL_COLOR)
  pushQuad(positions, indices, normals, b2, b3, t3, t2, undefined, colors, WATERMILL_COLOR)
  pushQuad(positions, indices, normals, b3, b0, t0, t3, undefined, colors, WATERMILL_COLOR)

  // Pitched Roof & Gables
  const r0 = rot(-halfW, 0, ridgeZ)
  const r1 = rot(halfW, 0, ridgeZ)

  pushTri(positions, indices, normals, t0, t3, r0, undefined, colors, WATERMILL_ROOF_COLOR)
  pushTri(positions, indices, normals, t2, t1, r1, undefined, colors, WATERMILL_ROOF_COLOR)
  pushQuad(positions, indices, normals, t0, t1, r1, r0, undefined, colors, WATERMILL_ROOF_COLOR)
  pushQuad(positions, indices, normals, t3, r0, r1, t2, undefined, colors, WATERMILL_ROOF_COLOR)

  // 2. Attached 12-Spoke Waterwheel on side
  const wheelR = 2.2
  const wheelX = halfW + 0.55
  const wheelZ = zBase + 0.8
  const spokes = 12
  const wheelThick = 0.55

  for (let s = 0; s < spokes; s++) {
    const a0 = (s / spokes) * Math.PI * 2
    const a1 = ((s + 1) / spokes) * Math.PI * 2

    const dy0 = Math.cos(a0) * wheelR
    const dz0 = Math.sin(a0) * wheelR
    const dy1 = Math.cos(a1) * wheelR
    const dz1 = Math.sin(a1) * wheelR

    const p0A = rot(wheelX, dy0, wheelZ + dz0)
    const p1A = rot(wheelX, dy1, wheelZ + dz1)
    const p0B = rot(wheelX + wheelThick, dy0, wheelZ + dz0)
    const p1B = rot(wheelX + wheelThick, dy1, wheelZ + dz1)

    // Outer paddle rim
    pushQuad(positions, indices, normals, p0A, p1A, p1B, p0B, undefined, colors, WATERMILL_WHEEL_COLOR)

    // Spoke beam from axle to rim
    const pAxleA = rot(wheelX, 0, wheelZ)
    const pAxleB = rot(wheelX + wheelThick, 0, wheelZ)
    pushTri(positions, indices, normals, pAxleA, p0A, p1A, undefined, colors, WATERMILL_WHEEL_COLOR)
    pushTri(positions, indices, normals, pAxleB, p1B, p0B, undefined, colors, WATERMILL_WHEEL_COLOR)
  }

  // 3. Timber & Stone Sluice Flume (River Water Intake Channel)
  const sluiceL = 4.8
  const sluiceW = 1.1
  const sluiceZ = wheelZ + wheelR * 0.95
  const s0 = rot(wheelX - 0.2, -sluiceL, sluiceZ + 0.3)
  const s1 = rot(wheelX + sluiceW, -sluiceL, sluiceZ + 0.3)
  const s2 = rot(wheelX - 0.2, 0.4, sluiceZ - 0.35)
  const s3 = rot(wheelX + sluiceW, 0.4, sluiceZ - 0.35)
  pushQuad(positions, indices, normals, s0, s1, s3, s2, [0, 0, 1], colors, RIVER_WATER_COLOR)

  // Sluice timber side walls
  const sw0 = rot(wheelX - 0.2, -sluiceL, sluiceZ + 0.7)
  const sw1 = rot(wheelX - 0.2, 0.4, sluiceZ + 0.05)
  const sw2 = rot(wheelX + sluiceW, -sluiceL, sluiceZ + 0.7)
  const sw3 = rot(wheelX + sluiceW, 0.4, sluiceZ + 0.05)
  pushQuad(positions, indices, normals, s0, s2, sw1, sw0, undefined, colors, WATERMILL_ROOF_COLOR)
  pushQuad(positions, indices, normals, sw2, sw3, s3, s1, undefined, colors, WATERMILL_ROOF_COLOR)

  // Sluice gate control frame & wheel
  pushRotBox(positions, indices, normals, colors, cx - sin * (-sluiceL * 0.7) + cos * (wheelX + sluiceW * 0.5), cy + cos * (-sluiceL * 0.7) + sin * (wheelX + sluiceW * 0.5), sluiceZ + 0.9, 0.15, 0.9, 0.85, yaw, WOOD_PLANK_COLOR, cellSize)

  // 4. Tailrace Outflow Channel
  const tailL = 4.2
  const tailZ = zBase - 0.4
  const tL0 = rot(wheelX - 0.3, 0.2, tailZ)
  const tL1 = rot(wheelX + sluiceW + 0.2, 0.2, tailZ)
  const tL2 = rot(wheelX + sluiceW + 0.2, tailL, tailZ - 0.4)
  const tL3 = rot(wheelX - 0.3, tailL, tailZ - 0.4)
  pushQuad(positions, indices, normals, tL0, tL1, tL2, tL3, [0, 0, 1], colors, RIVER_WATER_COLOR)

  // 5. Riverside Loading Platform / Wharf with Barrels & Crates
  const dockW = 2.4, dockD = 3.6, dockZ = zBase + 0.15
  const dk0 = rot(-halfW - dockW, -dockD * 0.5, dockZ)
  const dk1 = rot(-halfW, -dockD * 0.5, dockZ)
  const dk2 = rot(-halfW, dockD * 0.5, dockZ)
  const dk3 = rot(-halfW - dockW, dockD * 0.5, dockZ)
  pushQuad(positions, indices, normals, dk0, dk1, dk2, dk3, [0, 0, 1], colors, WOOD_PLANK_COLOR)
  // Dock stone foundation
  const dkBot0 = rot(-halfW - dockW, -dockD * 0.5, zBase - 0.9)
  const dkBot3 = rot(-halfW - dockW, dockD * 0.5, zBase - 0.9)
  pushQuad(positions, indices, normals, dkBot0, dk0, dk3, dkBot3, undefined, colors, HOUSE_BASE_COLOR)

  // Grain barrels & flour crates on dock
  const barX0 = -halfW - 0.8, barY0 = -0.6
  pushCylinder(positions, indices, normals, colors, cx + barX0 * cos - barY0 * sin, cy + barX0 * sin + barY0 * cos, dockZ, dockZ + 0.75, 0.32, 0.32, 6, WOOD_BARREL_COLOR, cellSize)
  const barX1 = -halfW - 1.4, barY1 = -0.5
  pushCylinder(positions, indices, normals, colors, cx + barX1 * cos - barY1 * sin, cy + barX1 * sin + barY1 * cos, dockZ, dockZ + 0.75, 0.32, 0.32, 6, WOOD_BARREL_COLOR, cellSize)
  const crtX = -halfW - 0.9, crtY = 0.7
  pushRotBox(positions, indices, normals, colors, cx + crtX * cos - crtY * sin, cy + crtX * sin + crtY * cos, dockZ + 0.3, 0.65, 0.65, 0.6, yaw + 0.2, WOOD_CRATE_COLOR, cellSize)

  return {
    positions,
    indices,
    normals,
    colors,
    color: [...WATERMILL_COLOR],
    role: 'houses',
  }
}

// ─── 4. VILLAGE MARKETPLACE PLAZA ───────────────────────────────────────────

export interface VillagePlazaOpts {
  readonly center: [number, number]
  readonly radius?: number
  readonly heightGrid?: unknown
  readonly segments?: number
  readonly cellSize?: number
}

export function buildVillagePlazaMesh(opts: VillagePlazaOpts): SceneMesh | null {
  const [cx, cy] = opts.center
  const radius = opts.radius ?? 6.5
  const segs = opts.segments ?? 36
  const cellSize = opts.cellSize ?? 1

  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []
  const colors: number[] = []

  const rInner = radius * 0.58
  const rOuter = radius
  const pad = civicPadHeight(opts.heightGrid, cx / cellSize, cy / cellSize, rOuter / cellSize * 1.22 + 1.6)
  const zDeck = pad * cellSize + 0.28
  const zInner = zDeck + 0.14
  const ringSpecs: Array<{ r: number; inner: boolean; organic?: boolean }> = [
    { r: rInner * 0.38, inner: true },
    { r: rInner, inner: true },
    { r: (rInner + rOuter) * 0.52, inner: false },
    { r: rOuter, inner: false, organic: true },
  ]

  const rings: Array<Array<[number, number, number]>> = []
  for (const spec of ringSpecs) {
    const ring: Array<[number, number, number]> = []
    const z = spec.inner ? zInner : zDeck
    for (let i = 0; i < segs; i++) {
      const angle = (i / segs) * Math.PI * 2
      const rx = spec.organic
        ? Math.cos(angle) * spec.r * (1 + Math.cos(angle * 2) * 0.12)
        : Math.cos(angle) * spec.r
      const ry = spec.organic
        ? Math.sin(angle) * spec.r * (1 - Math.cos(angle * 2) * 0.08)
        : Math.sin(angle) * spec.r
      const px = cx + rx
      const py = cy + ry
      ring.push([px * cellSize, -py * cellSize, z])
    }
    rings.push(ring)
  }

  const outerRing = rings[rings.length - 1]!
  const outerCurbBot: Array<[number, number, number]> = []
  const outerBalustradeTop: Array<[number, number, number]> = []
  for (const p of outerRing) {
    outerCurbBot.push([p[0], p[1], p[2] - 1.85])
    outerBalustradeTop.push([p[0], p[1], p[2] + 0.72])
  }

  const cInnerPoint: [number, number, number] = [cx * cellSize, -cy * cellSize, zInner]
  const firstRing = rings[0]!
  for (let i = 0; i < segs; i++) {
    const next = (i + 1) % segs
    pushTri(positions, indices, normals, cInnerPoint, firstRing[i]!, firstRing[next]!, undefined, colors, PLAZA_COLOR)
  }
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r]!
    const b = rings[r + 1]!
    const innerBand = ringSpecs[r + 1]!.inner
    const col = innerBand ? PLAZA_COLOR : PLAZA_COLOR
    const step = ringSpecs[r]!.inner && !ringSpecs[r + 1]!.inner
    for (let i = 0; i < segs; i++) {
      const next = (i + 1) % segs
      if (step) {
        pushQuad(positions, indices, normals, a[i]!, a[next]!, b[next]!, b[i]!, undefined, colors, PLAZA_MONUMENT_COLOR)
      } else {
        pushQuad(positions, indices, normals, a[i]!, a[next]!, b[next]!, b[i]!, undefined, colors, col)
      }
    }
  }

  const isGate = (ang: number) => [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5].some((g) => {
    let diff = Math.abs(ang - g)
    while (diff > Math.PI) diff -= Math.PI * 2
    return Math.abs(diff) < 0.28
  })

  for (let i = 0; i < segs; i++) {
    const next = (i + 1) % segs
    const ang = (i / segs) * Math.PI * 2
    pushQuad(positions, indices, normals, outerRing[i]!, outerCurbBot[i]!, outerCurbBot[next]!, outerRing[next]!, undefined, colors, PLAZA_MONUMENT_COLOR)

    if (!isGate(ang)) {
      pushQuad(positions, indices, normals, outerRing[i]!, outerRing[next]!, outerBalustradeTop[next]!, outerBalustradeTop[i]!, undefined, colors, PLAZA_MONUMENT_COLOR)
    } else {
      const rampDist = 2.4
      const a0x = cx + Math.cos(ang) * (rOuter + rampDist)
      const a0y = cy + Math.sin(ang) * (rOuter + rampDist)
      const a1x = cx + Math.cos(ang + (1 / segs) * Math.PI * 2) * (rOuter + rampDist)
      const a1y = cy + Math.sin(ang + (1 / segs) * Math.PI * 2) * (rOuter + rampDist)
      const pOut0: [number, number, number] = [a0x * cellSize, -a0y * cellSize, drapeSurfaceZ(opts.heightGrid, a0x / cellSize, a0y / cellSize, cellSize, 0.08)]
      const pOut1: [number, number, number] = [a1x * cellSize, -a1y * cellSize, drapeSurfaceZ(opts.heightGrid, a1x / cellSize, a1y / cellSize, cellSize, 0.08)]
      pushQuad(positions, indices, normals, outerRing[i]!, outerRing[next]!, pOut1, pOut0, undefined, colors, PLAZA_COLOR)
    }
  }

  // 2. Central Village Fountain Monument with Water Pool & Gargoyle Spouts
  const wellSegs = 8
  const rFountOut = 1.75
  const rFountIn = 1.35
  const hFountWall = 0.85
  const wellRingOut: Array<[number, number, number]> = []
  const wellRingIn: Array<[number, number, number]> = []
  const wellWaterRing: Array<[number, number, number]> = []

  for (let i = 0; i < wellSegs; i++) {
    const a = (i / wellSegs) * Math.PI * 2
    const ox = (cx + Math.cos(a) * rFountOut) * cellSize
    const oy = -(cy + Math.sin(a) * rFountOut) * cellSize
    const ix = (cx + Math.cos(a) * rFountIn) * cellSize
    const iy = -(cy + Math.sin(a) * rFountIn) * cellSize
    wellRingOut.push([ox, oy, zInner + hFountWall])
    wellRingIn.push([ix, iy, zInner + hFountWall])
    wellWaterRing.push([ix, iy, zInner + hFountWall * 0.65])
  }

  const cWaterPt: [number, number, number] = [cx * cellSize, -cy * cellSize, zInner + hFountWall * 0.65]
  const cFloorPt: [number, number, number] = [cx * cellSize, -cy * cellSize, zInner + 0.04]

  for (let i = 0; i < wellSegs; i++) {
    const next = (i + 1) % wellSegs
    const bOut0: [number, number, number] = [wellRingOut[i]![0], wellRingOut[i]![1], zInner]
    const bOut1: [number, number, number] = [wellRingOut[next]![0], wellRingOut[next]![1], zInner]
    pushQuad(positions, indices, normals, bOut0, bOut1, wellRingOut[next]!, wellRingOut[i]!, undefined, colors, PLAZA_MONUMENT_COLOR)
    pushQuad(positions, indices, normals, wellRingOut[i]!, wellRingOut[next]!, wellRingIn[next]!, wellRingIn[i]!, [0, 0, 1], colors, PLAZA_MONUMENT_COLOR)
    const floor0: [number, number, number] = [wellRingIn[i]![0], wellRingIn[i]![1], zInner + 0.04]
    const floor1: [number, number, number] = [wellRingIn[next]![0], wellRingIn[next]![1], zInner + 0.04]
    pushTri(positions, indices, normals, cFloorPt, floor0, floor1, [0, 0, 1], colors, PLAZA_MONUMENT_COLOR)
    pushTri(positions, indices, normals, cWaterPt, wellWaterRing[i]!, wellWaterRing[next]!, [0, 0, 1], colors, FOUNTAIN_WATER_COLOR)
  }

  // Center Carved Fountain Obelisk with Finial
  const pillarW = 0.65
  const pillarH = 2.6
  pushRotBox(positions, indices, normals, colors, cx, cy, zInner + pillarH * 0.5, pillarW, pillarW, pillarH, 0, PLAZA_MONUMENT_COLOR, cellSize)
  // Lion / Gargoyle Spout Blocks on 4 Cardinal Sides
  for (const [sx, sy] of [[0.42, 0], [-0.42, 0], [0, 0.42], [0, -0.42]]) {
    pushRotBox(positions, indices, normals, colors, cx + sx, cy + sy, zInner + 1.2, 0.22, 0.22, 0.22, 0, PLAZA_MONUMENT_COLOR, cellSize)
  }
  // Finial Pyramid & Sphere Cap
  const pApex: [number, number, number] = [cx * cellSize, -cy * cellSize, zInner + pillarH + 0.8]
  const pt0 = [(cx - pillarW * 0.5) * cellSize, (-cy - pillarW * 0.5) * cellSize, zInner + pillarH] as [number, number, number]
  const pt1 = [(cx + pillarW * 0.5) * cellSize, (-cy - pillarW * 0.5) * cellSize, zInner + pillarH] as [number, number, number]
  const pt2 = [(cx + pillarW * 0.5) * cellSize, (-cy + pillarW * 0.5) * cellSize, zInner + pillarH] as [number, number, number]
  const pt3 = [(cx - pillarW * 0.5) * cellSize, (-cy + pillarW * 0.5) * cellSize, zInner + pillarH] as [number, number, number]
  pushTri(positions, indices, normals, pt0, pt1, pApex, undefined, colors, PLAZA_MONUMENT_COLOR)
  pushTri(positions, indices, normals, pt1, pt2, pApex, undefined, colors, PLAZA_MONUMENT_COLOR)
  pushTri(positions, indices, normals, pt2, pt3, pApex, undefined, colors, PLAZA_MONUMENT_COLOR)
  pushTri(positions, indices, normals, pt3, pt0, pApex, undefined, colors, PLAZA_MONUMENT_COLOR)

  // 3. Marketplace Life: Canvas Market Tents, Produce Crates, Wine Barrels & Benches
  const stallAngles = [Math.PI * 0.22, Math.PI * 0.76, Math.PI * 1.24, Math.PI * 1.78]
  const canopyColors = [MARKET_CANOPY_RED, MARKET_CANOPY_BLUE, MARKET_CANOPY_GOLD, MARKET_CANOPY_RED]

  for (let s = 0; s < stallAngles.length; s++) {
    const sAng = stallAngles[s]!
    const sR = (rInner + rOuter) * 0.48
    const sx = cx + Math.cos(sAng) * sR
    const sy = cy + Math.sin(sAng) * sR
    const sz = sR <= rInner ? zInner : zDeck
    const sYaw = sAng + Math.PI * 0.5
    const cColor = canopyColors[s % canopyColors.length]!

    // 4 Wooden Frame Corner Posts
    const stW = 2.4, stD = 1.6, stH = 2.1
    const hW = stW * 0.5, hD = stD * 0.5
    for (const [px, py] of [[-hW, -hD], [hW, -hD], [hW, hD], [-hW, hD]]) {
      const cosY = Math.cos(-sYaw), sinY = Math.sin(-sYaw)
      const wx = sx + px * cosY - py * sinY
      const wy = sy + px * sinY + py * cosY
      pushRotBox(positions, indices, normals, colors, wx, wy, sz + stH * 0.5, 0.1, 0.1, stH, sYaw, WOOD_PLANK_COLOR, cellSize)
    }

    // Merchant Display Table
    pushRotBox(positions, indices, normals, colors, sx, sy, sz + 0.75, stW * 0.85, stD * 0.6, 0.1, sYaw, WOOD_PLANK_COLOR, cellSize)
    // Table legs
    pushRotBox(positions, indices, normals, colors, sx, sy, sz + 0.35, stW * 0.7, stD * 0.45, 0.7, sYaw, WOOD_PLANK_COLOR, cellSize)

    // Pitched Striped Canvas Canopy
    const cosY = Math.cos(-sYaw), sinY = Math.sin(-sYaw)
    const rotS = (lx: number, ly: number, lz: number): [number, number, number] => [
      (sx + lx * cosY - ly * sinY) * cellSize,
      -(sy + lx * sinY + ly * cosY) * cellSize,
      sz + lz,
    ]
    const c0 = rotS(-hW - 0.2, -hD - 0.2, stH)
    const c1 = rotS( hW + 0.2, -hD - 0.2, stH)
    const c2 = rotS( hW + 0.2,  hD + 0.2, stH)
    const c3 = rotS(-hW - 0.2,  hD + 0.2, stH)
    const rL = rotS(-hW - 0.2, 0, stH + 0.65)
    const rR = rotS( hW + 0.2, 0, stH + 0.65)

    pushQuad(positions, indices, normals, c0, c1, rR, rL, undefined, colors, cColor)
    pushQuad(positions, indices, normals, c3, rL, rR, c2, undefined, colors, MARKET_CANOPY_STRIPE)
    pushTri(positions, indices, normals, c0, rL, c3, undefined, colors, cColor)
    pushTri(positions, indices, normals, c1, c2, rR, undefined, colors, cColor)

    // Crates & Barrels beside stall
    const crtOffX = sx + Math.cos(sYaw) * (hW + 0.5)
    const crtOffY = sy + Math.sin(sYaw) * (hW + 0.5)
    pushRotBox(positions, indices, normals, colors, crtOffX, crtOffY, sz + 0.25, 0.55, 0.55, 0.5, sYaw + 0.3, WOOD_CRATE_COLOR, cellSize)
    const barOffX = sx - Math.cos(sYaw) * (hW + 0.5)
    const barOffY = sy - Math.sin(sYaw) * (hW + 0.5)
    pushCylinder(positions, indices, normals, colors, barOffX, barOffY, sz, sz + 0.7, 0.3, 0.3, 6, WOOD_BARREL_COLOR, cellSize)
  }

  // Stone Rest Benches around plaza perimeter
  for (const bAng of [Math.PI * 0.4, Math.PI * 1.4]) {
    const bx = cx + Math.cos(bAng) * (rOuter - 0.8)
    const by = cy + Math.sin(bAng) * (rOuter - 0.8)
    const bz = zDeck
    pushRotBox(positions, indices, normals, colors, bx, by, bz + 0.45, 1.6, 0.45, 0.12, bAng + Math.PI * 0.5, PLAZA_MONUMENT_COLOR, cellSize)
    pushRotBox(positions, indices, normals, colors, bx, by, bz + 0.22, 1.2, 0.35, 0.44, bAng + Math.PI * 0.5, PLAZA_MONUMENT_COLOR, cellSize)
  }

  return {
    positions,
    indices,
    normals,
    colors,
    color: [...PLAZA_COLOR],
    role: 'road',
  }
}

// ─── 5. STEPPED TERRACE RETAINING WALLS ──────────────────────────────────────

export interface RetainingWallsOpts {
  readonly curves: Array<Array<[number, number]>>
  readonly heightGrid?: unknown
  readonly wallThickness?: number
  readonly wallHeight?: number
  readonly cellSize?: number
}

export function buildRetainingWallsMesh(opts: RetainingWallsOpts): SceneMesh | null {
  const thickness = opts.wallThickness ?? 0.4
  const defaultH = opts.wallHeight ?? 1.4
  const cellSize = opts.cellSize ?? 1

  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []
  const colors: number[] = []

  for (const curve of opts.curves) {
    if (curve.length < 2) continue
    const half = thickness * 0.5

    for (let i = 0; i < curve.length - 1; i++) {
      const [x0, y0] = curve[i]!
      const [x1, y1] = curve[i + 1]!

      const dx = x1 - x0
      const dy = y1 - y0
      const len = Math.hypot(dx, dy)
      if (len < 0.2) continue

      const nx = -dy / len
      const ny = dx / len

      const z0 = surfaceZ(opts.heightGrid, x0, y0, cellSize)
      const z1 = surfaceZ(opts.heightGrid, x1, y1, cellSize)
      const zTop0 = z0 + defaultH * 0.4
      const zBot0 = z0 - defaultH * 0.8
      const zTop1 = z1 + defaultH * 0.4
      const zBot1 = z1 - defaultH * 0.8

      const t0L: [number, number, number] = [(x0 + nx * half) * cellSize, (-y0 - ny * half) * cellSize, zTop0]
      const t0R: [number, number, number] = [(x0 - nx * half) * cellSize, (-y0 + ny * half) * cellSize, zTop0]
      const b0L: [number, number, number] = [(x0 + nx * half) * cellSize, (-y0 - ny * half) * cellSize, zBot0]
      const b0R: [number, number, number] = [(x0 - nx * half) * cellSize, (-y0 + ny * half) * cellSize, zBot0]

      const t1L: [number, number, number] = [(x1 + nx * half) * cellSize, (-y1 - ny * half) * cellSize, zTop1]
      const t1R: [number, number, number] = [(x1 - nx * half) * cellSize, (-y1 + ny * half) * cellSize, zTop1]
      const b1L: [number, number, number] = [(x1 + nx * half) * cellSize, (-y1 - ny * half) * cellSize, zBot1]
      const b1R: [number, number, number] = [(x1 - nx * half) * cellSize, (-y1 + ny * half) * cellSize, zBot1]

      pushQuad(positions, indices, normals, b0L, b1L, t1L, t0L, [nx, -ny, 0], colors, RETAINING_WALL_COLOR)
      pushQuad(positions, indices, normals, t0L, t1L, t1R, t0R, [0, 0, 1], colors, RETAINING_WALL_COLOR)
    }
  }

  if (indices.length === 0) return null

  return {
    positions,
    indices,
    normals,
    colors,
    color: [...RETAINING_WALL_COLOR],
    role: 'houses',
  }
}

// ─── 6. PROCEDURAL ALPINE PINE TREES ────────────────────────────────────────

export interface PineTreesOpts {
  readonly points: ReadonlyArray<readonly [number, number]>
  readonly heightGrid?: unknown
  readonly minHeight?: number
  readonly maxHeight?: number
  readonly seed?: number
  readonly cellSize?: number
}

export function buildPineTreesMesh(opts: PineTreesOpts): SceneMesh | null {
  const pts = opts.points
  if (!pts || pts.length === 0) return null
  const minH = opts.minHeight ?? 3.5
  const maxH = opts.maxHeight ?? 6.2
  const seed = opts.seed ?? 42
  const cellSize = opts.cellSize ?? 1

  let s = seed
  function rand(): number {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }

  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []
  const colors: number[] = []
  const sides = 6

  for (let p = 0; p < pts.length; p++) {
    const [px, py] = pts[p]!
    const zBase = surfaceZ(opts.heightGrid, px, py, cellSize)
    const treeH = minH + rand() * (maxH - minH)
    const trunkR = 0.22 + rand() * 0.08
    const trunkH = treeH * 0.35

    const cx = px * cellSize
    const cy = -py * cellSize

    // 1. Trunk (Hexagonal cylinder)
    const trunkRing0: Array<[number, number, number]> = []
    const trunkRing1: Array<[number, number, number]> = []
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2
      const rx = Math.cos(a) * trunkR
      const ry = Math.sin(a) * trunkR
      trunkRing0.push([cx + rx, cy + ry, zBase - 0.4])
      trunkRing1.push([cx + rx, cy + ry, zBase + trunkH])
    }
    for (let i = 0; i < sides; i++) {
      const next = (i + 1) % sides
      pushQuad(positions, indices, normals, trunkRing0[i]!, trunkRing0[next]!, trunkRing1[next]!, trunkRing1[i]!, undefined, colors, PINE_TRUNK_COLOR)
    }

    // 2. Conical Foliage Tiers (3 tiers of umbrella cones)
    const tiers = 3
    for (let tier = 0; tier < tiers; tier++) {
      const tierT = tier / tiers
      const nextT = (tier + 1) / tiers
      const zTierBase = zBase + trunkH * 0.7 + tierT * (treeH - trunkH * 0.7)
      const zTierApex = zBase + trunkH * 0.7 + nextT * (treeH - trunkH * 0.7) + 0.6
      const tierR = (1.8 - tierT * 0.9) * (treeH / 4.5)

      const fRing: Array<[number, number, number]> = []
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2 + (tier * 0.4)
        const rx = Math.cos(a) * tierR
        const ry = Math.sin(a) * tierR
        fRing.push([cx + rx, cy + ry, zTierBase])
      }

      const apexPt: [number, number, number] = [cx, cy, zTierApex]

      for (let i = 0; i < sides; i++) {
        const next = (i + 1) % sides
        pushTri(positions, indices, normals, fRing[i]!, fRing[next]!, apexPt, undefined, colors, PINE_FOLIAGE_COLOR)
      }
    }
  }

  return {
    positions,
    indices,
    normals,
    colors,
    color: [...PINE_FOLIAGE_COLOR],
    role: 'houses',
  }
}

// ─── 7. MULTI-TIER VILLAGE HOUSES ───────────────────────────────────────────

export type HouseType = 'cottage' | 'townhouse' | 'farmhouse' | 'barn' | 'cabin' | 'chalet'

export interface MultiTierHousePlot {
  readonly x: number
  readonly y: number
  readonly type?: HouseType
  readonly yaw?: number
  readonly scale?: number
  readonly district?: string
}

export function houseFootprint(type: HouseType | undefined): { w: number; d: number } {
  switch (type) {
    case 'townhouse': return { w: 4.8, d: 3.8 }
    case 'chalet': return { w: 5.6, d: 4.4 }
    case 'barn':
    case 'farmhouse': return { w: 6.4, d: 5.0 }
    case 'cabin': return { w: 3.6, d: 3.0 }
    default: return { w: 4.4, d: 3.6 }
  }
}

export interface MultiTierHousesOpts {
  readonly plots?: readonly MultiTierHousePlot[]
  readonly points?: unknown
  readonly heightGrid?: unknown
  readonly cellSize?: number
}

/** Helper to sample height at an arbitrary rotated 2D offset from a center point */
function rotCorner(
  cx: number,
  cy: number,
  lx: number,
  ly: number,
  cos: number,
  sin: number,
  scale: number,
): [number, number] {
  return [
    cx + (lx * cos - ly * sin) * scale,
    cy + (lx * sin + ly * cos) * scale,
  ]
}

export function buildMultiTierHousesMesh(opts: MultiTierHousesOpts): SceneMesh | null {
  // Normalize plots from either explicit plots array or points DataTree/array
  let rawPlots: MultiTierHousePlot[] = []
  if (Array.isArray(opts.plots) && opts.plots.length > 0) {
    rawPlots = opts.plots as MultiTierHousePlot[]
  } else if (opts.points) {
    let cur: unknown = opts.points
    if (cur && typeof cur === 'object' && 'items' in cur) {
      cur = (cur as { items: unknown }).items
    }
    if (Array.isArray(cur)) {
      for (const item of cur) {
        if (Array.isArray(item) && item.length >= 2) {
          rawPlots.push({ x: Number(item[0]), y: Number(item[1]) })
        } else if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>
          rawPlots.push({
            x: Number(o.x ?? 0),
            y: Number(o.y ?? 0),
            type: o.type as HouseType,
            yaw: o.yaw !== undefined ? Number(o.yaw) : undefined,
            scale: o.scale !== undefined ? Number(o.scale) : undefined,
            district: o.district as string,
          })
        }
      }
    }
  }

  if (rawPlots.length === 0) return null
  const cellSize = opts.cellSize ?? 1

  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []
  const colors: number[] = []

  for (const plot of rawPlots) {
    const type = plot.type ?? 'cottage'
    const cx = plot.x
    const cy = plot.y
    const yaw = plot.yaw ?? 0
    const scale = plot.scale ?? 1.0

    const cos = Math.cos(-yaw)
    const sin = Math.sin(-yaw)

    const rot = (lx: number, ly: number, z: number): [number, number, number] => [
      (cx + (lx * cos - ly * sin) * scale) * cellSize,
      -(cy + (lx * sin + ly * cos) * scale) * cellSize,
      z,
    ]

    // Architectural dimensions
    let w = 4.4, d = 3.6, wallH = 2.6, roofH = 2.2
    if (type === 'townhouse') {
      w = 4.8; d = 3.8; wallH = 4.6; roofH = 2.4
    } else if (type === 'chalet') {
      w = 5.6; d = 4.4; wallH = 3.4; roofH = 2.0
    } else if (type === 'barn' || type === 'farmhouse') {
      w = 6.4; d = 5.0; wallH = 3.0; roofH = 2.4
    } else if (type === 'cabin') {
      w = 3.6; d = 3.0; wallH = 2.2; roofH = 1.8
    }

    const halfW = w * 0.5
    const halfD = d * 0.5

    // Sample true rotated ground corners
    const c0 = rotCorner(cx, cy, -halfW, -halfD, cos, sin, scale)
    const c1 = rotCorner(cx, cy,  halfW, -halfD, cos, sin, scale)
    const c2 = rotCorner(cx, cy,  halfW,  halfD, cos, sin, scale)
    const c3 = rotCorner(cx, cy, -halfW,  halfD, cos, sin, scale)

    const z0 = surfaceZ(opts.heightGrid, c0[0], c0[1], cellSize)
    const z1 = surfaceZ(opts.heightGrid, c1[0], c1[1], cellSize)
    const z2 = surfaceZ(opts.heightGrid, c2[0], c2[1], cellSize)
    const z3 = surfaceZ(opts.heightGrid, c3[0], c3[1], cellSize)
    const zCenter = surfaceZ(opts.heightGrid, cx, cy, cellSize)

    const minCornerZ = Math.min(z0, z1, z2, z3, zCenter)
    const maxCornerZ = Math.max(z0, z1, z2, z3, zCenter)

    // Leveled stone plinth foundation (no floating, no uphill ground clipping)
    const floorZ = maxCornerZ + 0.04
    const plinthBotZ = minCornerZ - 0.85

    // 1. Foundation Plinth (Rustic Stone Base)
    const pb0 = rot(-halfW, -halfD, plinthBotZ)
    const pb1 = rot( halfW, -halfD, plinthBotZ)
    const pb2 = rot( halfW,  halfD, plinthBotZ)
    const pb3 = rot(-halfW,  halfD, plinthBotZ)

    const pf0 = rot(-halfW, -halfD, floorZ)
    const pf1 = rot( halfW, -halfD, floorZ)
    const pf2 = rot( halfW,  halfD, floorZ)
    const pf3 = rot(-halfW,  halfD, floorZ)

    pushQuad(positions, indices, normals, pb0, pb1, pf1, pf0, undefined, colors, HOUSE_BASE_COLOR)
    pushQuad(positions, indices, normals, pb1, pb2, pf2, pf1, undefined, colors, HOUSE_BASE_COLOR)
    pushQuad(positions, indices, normals, pb2, pb3, pf3, pf2, undefined, colors, HOUSE_BASE_COLOR)
    pushQuad(positions, indices, normals, pb3, pb0, pf0, pf3, undefined, colors, HOUSE_BASE_COLOR)

    if (type === 'townhouse') {
      // 2-Story Townhouse with Cantilevered 2nd Floor & Dormer
      const f1Z = floorZ + 2.3
      const f2Z = f1Z + 2.3
      const w2 = w + 0.5, d2 = d + 0.4
      const hW2 = w2 * 0.5, hD2 = d2 * 0.5

      // 1st floor walls
      const t1_0 = rot(-halfW, -halfD, f1Z)
      const t1_1 = rot( halfW, -halfD, f1Z)
      const t1_2 = rot( halfW,  halfD, f1Z)
      const t1_3 = rot(-halfW,  halfD, f1Z)

      pushQuad(positions, indices, normals, pf0, pf1, t1_1, t1_0, undefined, colors, HOUSE_BASE_COLOR)
      pushQuad(positions, indices, normals, pf1, pf2, t1_2, t1_1, undefined, colors, HOUSE_BASE_COLOR)
      pushQuad(positions, indices, normals, pf2, pf3, t1_3, t1_2, undefined, colors, HOUSE_BASE_COLOR)
      pushQuad(positions, indices, normals, pf3, pf0, t1_0, t1_3, undefined, colors, HOUSE_BASE_COLOR)

      // 2nd floor cantilevered timber box
      const f2_0 = rot(-hW2, -hD2, f1Z)
      const f2_1 = rot( hW2, -hD2, f1Z)
      const f2_2 = rot( hW2,  hD2, f1Z)
      const f2_3 = rot(-hW2,  hD2, f1Z)

      const top_0 = rot(-hW2, -hD2, f2Z)
      const top_1 = rot( hW2, -hD2, f2Z)
      const top_2 = rot( hW2,  hD2, f2Z)
      const top_3 = rot(-hW2,  hD2, f2Z)

      // Underhang soffit
      pushQuad(positions, indices, normals, f2_0, f2_1, t1_1, t1_0, [0, 0, -1], colors, HOUSE_TIMBER_COLOR)
      pushQuad(positions, indices, normals, f2_1, f2_2, t1_2, t1_1, [0, 0, -1], colors, HOUSE_TIMBER_COLOR)
      pushQuad(positions, indices, normals, f2_2, f2_3, t1_3, t1_2, [0, 0, -1], colors, HOUSE_TIMBER_COLOR)
      pushQuad(positions, indices, normals, f2_3, f2_0, t1_0, t1_3, [0, 0, -1], colors, HOUSE_TIMBER_COLOR)

      // 2nd floor walls
      pushQuad(positions, indices, normals, f2_0, f2_1, top_1, top_0, undefined, colors, HOUSE_WALL_COLOR)
      pushQuad(positions, indices, normals, f2_1, f2_2, top_2, top_1, undefined, colors, HOUSE_WALL_COLOR)
      pushQuad(positions, indices, normals, f2_2, f2_3, top_3, top_2, undefined, colors, HOUSE_WALL_COLOR)
      pushQuad(positions, indices, normals, f2_3, f2_0, top_0, top_3, undefined, colors, HOUSE_WALL_COLOR)

      // Steep terracotta tile gable roof
      const rZ = f2Z + roofH
      const ridge0 = rot(-hW2, 0, rZ)
      const ridge1 = rot( hW2, 0, rZ)

      pushTri(positions, indices, normals, top_0, top_3, ridge0, undefined, colors, HOUSE_ROOF_COLOR)
      pushTri(positions, indices, normals, top_2, top_1, ridge1, undefined, colors, HOUSE_ROOF_COLOR)
      pushQuad(positions, indices, normals, top_0, top_1, ridge1, ridge0, undefined, colors, HOUSE_ROOF_COLOR)
      pushQuad(positions, indices, normals, top_3, ridge0, ridge1, top_2, undefined, colors, HOUSE_ROOF_COLOR)

      // Stone chimney
      const chX = hW2 - 0.4, chY = hD2 - 0.4, chW = 0.6
      const c0ch = rot(chX - chW * 0.5, chY - chW * 0.5, floorZ)
      const c1ch = rot(chX + chW * 0.5, chY - chW * 0.5, floorZ)
      const c2ch = rot(chX + chW * 0.5, chY + chW * 0.5, floorZ)
      const c3ch = rot(chX - chW * 0.5, chY + chW * 0.5, floorZ)
      const ct0ch = rot(chX - chW * 0.5, chY - chW * 0.5, rZ + 0.9)
      const ct1ch = rot(chX + chW * 0.5, chY - chW * 0.5, rZ + 0.9)
      const ct2ch = rot(chX + chW * 0.5, chY + chW * 0.5, rZ + 0.9)
      const ct3ch = rot(chX - chW * 0.5, chY + chW * 0.5, rZ + 0.9)

      pushQuad(positions, indices, normals, c0ch, c1ch, ct1ch, ct0ch, undefined, colors, HOUSE_CHIMNEY_COLOR)
      pushQuad(positions, indices, normals, c1ch, c2ch, ct2ch, ct1ch, undefined, colors, HOUSE_CHIMNEY_COLOR)
      pushQuad(positions, indices, normals, c2ch, c3ch, ct3ch, ct2ch, undefined, colors, HOUSE_CHIMNEY_COLOR)
      pushQuad(positions, indices, normals, c3ch, c0ch, ct0ch, ct3ch, undefined, colors, HOUSE_CHIMNEY_COLOR)
      pushQuad(positions, indices, normals, ct0ch, ct1ch, ct2ch, ct3ch, [0, 0, 1], colors, HOUSE_CHIMNEY_COLOR)

    } else if (type === 'chalet') {
      // Alpine Chalet with Wraparound Timber Balcony, Corbels & Downhill Panoramic Deck
      const topZ = floorZ + wallH
      const t0 = rot(-halfW, -halfD, topZ)
      const t1 = rot( halfW, -halfD, topZ)
      const t2 = rot( halfW,  halfD, topZ)
      const t3 = rot(-halfW,  halfD, topZ)

      pushQuad(positions, indices, normals, pf0, pf1, t1, t0, undefined, colors, HOUSE_WALL_COLOR)
      pushQuad(positions, indices, normals, pf1, pf2, t2, t1, undefined, colors, HOUSE_WALL_COLOR)
      pushQuad(positions, indices, normals, pf2, pf3, t3, t2, undefined, colors, HOUSE_WALL_COLOR)
      pushQuad(positions, indices, normals, pf3, pf0, t0, t3, undefined, colors, HOUSE_WALL_COLOR)

      // Wraparound timber balcony on downhill side (front)
      const balZ = floorZ + 1.8
      const bW = w + 0.8, bD = d + 0.8
      const bal0 = rot(-bW * 0.5, -bD * 0.5, balZ)
      const bal1 = rot( bW * 0.5, -bD * 0.5, balZ)
      const bal2 = rot( bW * 0.5,  bD * 0.5, balZ)
      const bal3 = rot(-bW * 0.5,  bD * 0.5, balZ)
      const balT0 = rot(-bW * 0.5, -bD * 0.5, balZ + 0.7)
      const balT1 = rot( bW * 0.5, -bD * 0.5, balZ + 0.7)
      const balT2 = rot( bW * 0.5,  bD * 0.5, balZ + 0.7)
      const balT3 = rot(-bW * 0.5,  bD * 0.5, balZ + 0.7)

      // Balcony deck & railings
      pushQuad(positions, indices, normals, bal0, bal1, balT1, balT0, undefined, colors, HOUSE_TIMBER_COLOR)
      pushQuad(positions, indices, normals, bal1, bal2, balT2, balT1, undefined, colors, HOUSE_TIMBER_COLOR)
      pushQuad(positions, indices, normals, bal2, bal3, balT3, balT2, undefined, colors, HOUSE_TIMBER_COLOR)
      pushQuad(positions, indices, normals, bal3, bal0, balT0, balT3, undefined, colors, HOUSE_TIMBER_COLOR)
      pushQuad(positions, indices, normals, bal0, bal1, bal2, bal3, [0, 0, 1], colors, WOOD_PLANK_COLOR)

      // Cantilever diagonal timber struts under balcony
      const stBot0 = rot(-bW * 0.4, -halfD, floorZ + 0.4)
      const stTop0 = rot(-bW * 0.4, -bD * 0.5, balZ)
      const stBot1 = rot( bW * 0.4, -halfD, floorZ + 0.4)
      const stTop1 = rot( bW * 0.4, -bD * 0.5, balZ)
      pushRotBox(positions, indices, normals, colors, cx - sin * (-bD * 0.45) - cos * (bW * 0.4), cy + cos * (-bD * 0.45) - sin * (bW * 0.4), balZ - 0.4, 0.12, 0.6, 0.8, yaw, HOUSE_TIMBER_COLOR, cellSize)
      pushRotBox(positions, indices, normals, colors, cx - sin * (-bD * 0.45) + cos * (bW * 0.4), cy + cos * (-bD * 0.45) + sin * (bW * 0.4), balZ - 0.4, 0.12, 0.6, 0.8, yaw, HOUSE_TIMBER_COLOR, cellSize)

      // Broad low-pitch overhanging chalet roof
      const rZ = topZ + roofH
      const eavesW = w + 1.2, eavesD = d + 1.2
      const rE0 = rot(-eavesW * 0.5, -eavesD * 0.5, topZ + 0.2)
      const rE1 = rot( eavesW * 0.5, -eavesD * 0.5, topZ + 0.2)
      const rE2 = rot( eavesW * 0.5,  eavesD * 0.5, topZ + 0.2)
      const rE3 = rot(-eavesW * 0.5,  eavesD * 0.5, topZ + 0.2)
      const ridge0 = rot(-eavesW * 0.5, 0, rZ)
      const ridge1 = rot( eavesW * 0.5, 0, rZ)

      pushTri(positions, indices, normals, rE0, rE3, ridge0, undefined, colors, HOUSE_ROOF_COLOR)
      pushTri(positions, indices, normals, rE2, rE1, ridge1, undefined, colors, HOUSE_ROOF_COLOR)
      pushQuad(positions, indices, normals, rE0, rE1, ridge1, ridge0, undefined, colors, HOUSE_ROOF_COLOR)
      pushQuad(positions, indices, normals, rE3, ridge0, ridge1, rE2, undefined, colors, HOUSE_ROOF_COLOR)

      // Attached uphill woodshed annex with firewood stack
      const shedW = 1.6, shedD = d * 0.65, shedH = 1.6
      const wsX = halfW + shedW * 0.5, wsY = 0.2
      pushRotBox(positions, indices, normals, colors, cx + wsX * cos - wsY * sin, cy + wsX * sin + wsY * cos, floorZ + shedH * 0.5, shedW, shedD, shedH, yaw, HOUSE_TIMBER_COLOR, cellSize)
      // Stacked firewood logs under shelter
      pushRotBox(positions, indices, normals, colors, cx + wsX * cos - wsY * sin, cy + wsX * sin + wsY * cos, floorZ + 0.35, shedW * 0.8, shedD * 0.8, 0.7, yaw, WOOD_BARREL_COLOR, cellSize)

    } else if (type === 'barn' || type === 'farmhouse') {
      // Wide Farmstead Barn with Timber Siding & Attached Shed
      const topZ = floorZ + wallH
      const t0 = rot(-halfW, -halfD, topZ)
      const t1 = rot( halfW, -halfD, topZ)
      const t2 = rot( halfW,  halfD, topZ)
      const t3 = rot(-halfW,  halfD, topZ)

      pushQuad(positions, indices, normals, pf0, pf1, t1, t0, undefined, colors, HOUSE_TIMBER_COLOR)
      pushQuad(positions, indices, normals, pf1, pf2, t2, t1, undefined, colors, HOUSE_TIMBER_COLOR)
      pushQuad(positions, indices, normals, pf2, pf3, t3, t2, undefined, colors, HOUSE_TIMBER_COLOR)
      pushQuad(positions, indices, normals, pf3, pf0, t0, t3, undefined, colors, HOUSE_TIMBER_COLOR)

      const rZ = topZ + roofH
      const r0 = rot(-halfW, 0, rZ)
      const r1 = rot( halfW, 0, rZ)

      pushTri(positions, indices, normals, t0, t3, r0, undefined, colors, HOUSE_ROOF_COLOR)
      pushTri(positions, indices, normals, t2, t1, r1, undefined, colors, HOUSE_ROOF_COLOR)
      pushQuad(positions, indices, normals, t0, t1, r1, r0, undefined, colors, HOUSE_ROOF_COLOR)
      pushQuad(positions, indices, normals, t3, r0, r1, t2, undefined, colors, HOUSE_ROOF_COLOR)

      // Attached lean-to shed
      const shedW = 2.2, shedD = d * 0.8, shedH = 1.9
      const sb0 = rot(-halfW - shedW, -shedD * 0.5, floorZ)
      const sb1 = rot(-halfW, -shedD * 0.5, floorZ)
      const sb2 = rot(-halfW,  shedD * 0.5, floorZ)
      const sb3 = rot(-halfW - shedW,  shedD * 0.5, floorZ)
      const st0 = rot(-halfW - shedW, -shedD * 0.5, floorZ + shedH)
      const st1 = rot(-halfW, -shedD * 0.5, floorZ + shedH + 0.9)
      const st2 = rot(-halfW,  shedD * 0.5, floorZ + shedH + 0.9)
      const st3 = rot(-halfW - shedW,  shedD * 0.5, floorZ + shedH)

      pushQuad(positions, indices, normals, sb0, sb1, st1, st0, undefined, colors, HOUSE_TIMBER_COLOR)
      pushQuad(positions, indices, normals, sb3, sb0, st0, st3, undefined, colors, HOUSE_TIMBER_COLOR)
      pushQuad(positions, indices, normals, sb2, sb3, st3, st2, undefined, colors, HOUSE_TIMBER_COLOR)
      pushQuad(positions, indices, normals, st0, st1, st2, st3, undefined, colors, HOUSE_ROOF_COLOR)

    } else {
      // Standard Gabled Cottage / Cabin
      const topZ = floorZ + wallH
      const t0 = rot(-halfW, -halfD, topZ)
      const t1 = rot( halfW, -halfD, topZ)
      const t2 = rot( halfW,  halfD, topZ)
      const t3 = rot(-halfW,  halfD, topZ)

      const wallColor = type === 'cabin' ? HOUSE_TIMBER_COLOR : HOUSE_WALL_COLOR
      pushQuad(positions, indices, normals, pf0, pf1, t1, t0, undefined, colors, wallColor)
      pushQuad(positions, indices, normals, pf1, pf2, t2, t1, undefined, colors, wallColor)
      pushQuad(positions, indices, normals, pf2, pf3, t3, t2, undefined, colors, wallColor)
      pushQuad(positions, indices, normals, pf3, pf0, t0, t3, undefined, colors, wallColor)

      const rZ = topZ + roofH
      const r0 = rot(-halfW, 0, rZ)
      const r1 = rot( halfW, 0, rZ)

      pushTri(positions, indices, normals, t0, t3, r0, undefined, colors, HOUSE_ROOF_COLOR)
      pushTri(positions, indices, normals, t2, t1, r1, undefined, colors, HOUSE_ROOF_COLOR)
      pushQuad(positions, indices, normals, t0, t1, r1, r0, undefined, colors, HOUSE_ROOF_COLOR)
      pushQuad(positions, indices, normals, t3, r0, r1, t2, undefined, colors, HOUSE_ROOF_COLOR)
    }
  }

  return {
    positions,
    indices,
    normals,
    colors,
    color: [...HOUSE_WALL_COLOR],
    role: 'houses',
  }
}

// ─── 8. PLAZA-CENTRIC ROAD NETWORK ────────────────────────────────────────────

export interface VillageRoadNetworkOpts {
  readonly plazaCenter?: unknown
  readonly plazaRadius?: number
  readonly riverPoints?: unknown
  readonly heightGrid?: unknown
  readonly seed?: number
  readonly riverWidth?: number
}

export interface VillageRoadNetworkResult {
  readonly arterialPoints: Array<[number, number]>
  readonly ringPoints: Array<[number, number]>
  readonly trailPoints: Array<[number, number]>
  readonly feederPoints: Array<[number, number]>
  readonly millAccessPoints: Array<[number, number]>
  readonly towerPosition: [number, number]
  readonly millPosition: [number, number]
  readonly millYaw: number
  readonly bridgeStart: [number, number]
  readonly bridgeEnd: [number, number]
  readonly plazaCenter: [number, number]
  readonly plazaRadius: number
  readonly mesh: SceneMesh | null
}

function samplePolylineFrame(pts: readonly Vec2[], t: number): { x: number; y: number; nx: number; ny: number } {
  if (pts.length === 0) return { x: 0, y: 0, nx: 0, ny: -1 }
  if (pts.length === 1) return { x: pts[0]!.x, y: pts[0]!.y, nx: 0, ny: -1 }
  const u = Math.max(0, Math.min(1, t))
  let total = 0
  const segs: number[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y)
    segs.push(len)
    total += len
  }
  if (total < 1e-6) return { x: pts[0]!.x, y: pts[0]!.y, nx: 0, ny: -1 }
  let remain = u * total
  for (let i = 0; i < segs.length; i++) {
    const len = segs[i]!
    if (remain <= len || i === segs.length - 1) {
      const s = len < 1e-6 ? 0 : remain / len
      const dx = pts[i + 1]!.x - pts[i]!.x
      const dy = pts[i + 1]!.y - pts[i]!.y
      const inv = 1 / (Math.hypot(dx, dy) || 1)
      return {
        x: pts[i]!.x + dx * s,
        y: pts[i]!.y + dy * s,
        nx: -dy * inv,
        ny: dx * inv,
      }
    }
    remain -= len
  }
  const last = pts[pts.length - 1]!
  const prev = pts[pts.length - 2]!
  const dx = last.x - prev.x, dy = last.y - prev.y
  const inv = 1 / (Math.hypot(dx, dy) || 1)
  return { x: last.x, y: last.y, nx: -dy * inv, ny: dx * inv }
}

function samplePolyline(pts: readonly Vec2[], t: number): Vec2 {
  const f = samplePolylineFrame(pts, t)
  return { x: f.x, y: f.y }
}

/** Flip a polyline normal so it points toward a landmark (village / plaza). */
function landwardNormal(
  nx: number,
  ny: number,
  fromX: number,
  fromY: number,
  towardX: number,
  towardY: number,
): { nx: number; ny: number } {
  if (nx * (towardX - fromX) + ny * (towardY - fromY) < 0) return { nx: -nx, ny: -ny }
  return { nx, ny }
}

/**
 * Yaw that aligns pushRotBox local +X with grid direction (dx, dy).
 * Local +X maps to (cos(yaw), -sin(yaw)) under the box rotation.
 */
function boxYawAlong(dx: number, dy: number): number {
  return Math.atan2(-dy, dx)
}

function closestOnPolyline(px: number, py: number, pts: readonly Vec2[]): { x: number; y: number; t: number; nx: number; ny: number } {
  if (pts.length === 0) return { x: px, y: py, t: 0, nx: 0, ny: 1 }
  if (pts.length === 1) return { x: pts[0]!.x, y: pts[0]!.y, t: 0, nx: 0, ny: 1 }
  let best = Infinity
  let bx = pts[0]!.x, by = pts[0]!.y, bt = 0, bnx = 0, bny = 1
  let acc = 0
  let total = 0
  for (let i = 0; i < pts.length - 1; i++) {
    total += Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y)
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i]!.x, ay = pts[i]!.y
    const cx = pts[i + 1]!.x, cy = pts[i + 1]!.y
    const dx = cx - ax, dy = cy - ay
    const l2 = dx * dx + dy * dy
    const segLen = Math.sqrt(l2)
    const t = l2 < 1e-8 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
    const qx = ax + t * dx, qy = ay + t * dy
    const d = Math.hypot(px - qx, py - qy)
    if (d < best) {
      best = d
      bx = qx
      by = qy
      bt = total < 1e-8 ? 0 : (acc + t * segLen) / total
      const inv = segLen < 1e-8 ? 1 : 1 / segLen
      bnx = -dy * inv
      bny = dx * inv
    }
    acc += segLen
  }
  return { x: bx, y: by, t: bt, nx: bnx, ny: bny }
}

function ringPoint(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]
}

function angleNear(a: number, b: number, window: number): boolean {
  let d = Math.abs(a - b) % (Math.PI * 2)
  if (d > Math.PI) d = Math.PI * 2 - d
  return d < window
}

function nrm2(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y) || 1
  return [x / l, y / l]
}

function bezier3(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
  t: number,
): [number, number] {
  const u = 1 - t
  const uu = u * u
  const tt = t * t
  return [
    uu * u * p0[0] + 3 * uu * t * p1[0] + 3 * u * tt * p2[0] + tt * t * p3[0],
    uu * u * p0[1] + 3 * uu * t * p1[1] + 3 * u * tt * p2[1] + tt * t * p3[1],
  ]
}

/** Leave `from` along `leave`, arrive at `to` along `arrive` (travel direction). */
function smoothJoin(
  from: readonly [number, number],
  leave: readonly [number, number],
  to: readonly [number, number],
  arrive: readonly [number, number],
  steps = 7,
): Array<[number, number]> {
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1])
  if (dist < 1.35) return [[from[0], from[1]], [to[0], to[1]]]
  const handle = Math.max(2.6, Math.min(dist * 0.34, 12))
  const lv = nrm2(leave[0], leave[1])
  const av = nrm2(arrive[0], arrive[1])
  const p1: [number, number] = [from[0] + lv[0] * handle, from[1] + lv[1] * handle]
  const p2: [number, number] = [to[0] - av[0] * handle, to[1] - av[1] * handle]
  const out: Array<[number, number]> = []
  for (let i = 0; i <= steps; i++) out.push(bezier3(from, p1, p2, to, i / steps))
  return out
}

function polylineTan(pts: ReadonlyArray<readonly [number, number]>, i: number): [number, number] {
  const i0 = Math.max(0, i - 1)
  const i1 = Math.min(pts.length - 1, i + 1)
  return nrm2(pts[i1]![0] - pts[i0]![0], pts[i1]![1] - pts[i0]![1])
}

function closestIndex(pts: ReadonlyArray<readonly [number, number]>, x: number, y: number): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i]![0] - x, pts[i]![1] - y)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

function leaveToward(
  tan: readonly [number, number],
  from: readonly [number, number],
  toward: readonly [number, number],
): [number, number] {
  const to = nrm2(toward[0] - from[0], toward[1] - from[1])
  let tx = tan[0]
  let ty = tan[1]
  if (tx * to[0] + ty * to[1] < 0) {
    tx = -tx
    ty = -ty
  }
  return nrm2(tx * 0.62 + to[0] * 0.38, ty * 0.62 + to[1] * 0.38)
}

function rayBudget(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  want: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): number {
  let t = want
  if (dx > 1e-6) t = Math.min(t, (maxX - ox) / dx)
  if (dx < -1e-6) t = Math.min(t, (minX - ox) / dx)
  if (dy > 1e-6) t = Math.min(t, (maxY - oy) / dy)
  if (dy < -1e-6) t = Math.min(t, (minY - oy) / dy)
  return Math.max(4, t)
}

export function generateVillageRoadNetwork(opts: VillageRoadNetworkOpts = {}): VillageRoadNetworkResult {
  const plazaPts = normalizePoints(opts.plazaCenter)
  const riverPts = normalizePoints(opts.riverPoints)
  const heightGrid = unwrapHeightGrid(opts.heightGrid)
  const W = heightGrid?.[0]?.length ?? 128
  const H = heightGrid?.length ?? 128
  const plazaR = Number(opts.plazaRadius ?? 7.4)
  const riverW = Number(opts.riverWidth ?? 8)
  const px = plazaPts[0]?.x ?? W * 0.56
  const py = plazaPts[0]?.y ?? H * 0.52

  const ringRoadR = plazaR + VILLAGE_RING_ROAD_OFFSET
  const ringCount = 20
  const ringOpen: Array<[number, number]> = []
  for (let i = 0; i < ringCount; i++) {
    ringOpen.push(ringPoint(px, py, ringRoadR, (i / ringCount) * Math.PI * 2))
  }
  const ringPoints: Array<[number, number]> = [...ringOpen, ringOpen[0]!]

  const westJ = ringPoint(px, py, ringRoadR, Math.PI)
  const eastJ = ringPoint(px, py, ringRoadR, 0)

  const riverHit = riverPts.length >= 2
    ? closestOnPolyline(px, py, riverPts)
    : { x: px, y: py - 14, t: 0.45, nx: 0, ny: -1 }
  const land = landwardNormal(riverHit.nx, riverHit.ny, riverHit.x, riverHit.y, px, py)
  let nx = land.nx, ny = land.ny
  const nLen = Math.hypot(nx, ny) || 1
  nx /= nLen
  ny /= nLen

  const bridgeStart: [number, number] = [
    riverHit.x - nx * (riverW * 0.5 + 2.2),
    riverHit.y - ny * (riverW * 0.5 + 2.2),
  ]
  const bridgeEnd: [number, number] = [
    riverHit.x + nx * (riverW * 0.5 + 2.2),
    riverHit.y + ny * (riverW * 0.5 + 2.2),
  ]

  const bankOffset = riverW * 0.5 + 6.2
  const bankPoint = (t: number): [number, number] => {
    if (riverPts.length < 2) return [px - 24 + t * 48, py - 5]
    const p = samplePolylineFrame(riverPts, t)
    const n = landwardNormal(p.nx, p.ny, p.x, p.y, px, py)
    const inv = 1 / (Math.hypot(n.nx, n.ny) || 1)
    return [p.x + n.nx * inv * bankOffset, p.y + n.ny * inv * bankOffset]
  }

  const bankRoad: Array<[number, number]> = []
  for (let i = 0; i <= 12; i++) bankRoad.push(bankPoint(0.07 + (0.86 * i) / 12))

  const excludeR = ringRoadR + 1.6
  const maxSideJoin = 16
  let firstInside = -1
  let lastInside = -1
  for (let i = 0; i < bankRoad.length; i++) {
    if (Math.hypot(bankRoad[i]![0] - px, bankRoad[i]![1] - py) < excludeR) {
      if (firstInside < 0) firstInside = i
      lastInside = i
    }
  }
  const plazaOnBank = firstInside >= 0
  const westBank = plazaOnBank && firstInside > 0 ? bankRoad.slice(0, firstInside) : []
  const eastBank = plazaOnBank && lastInside >= 0 && lastInside < bankRoad.length - 1
    ? bankRoad.slice(lastInside + 1)
    : []
  const openBank = plazaOnBank ? [...westBank, ...eastBank] : bankRoad

  const joinBankToGate = (
    bank: ReadonlyArray<[number, number]>,
    bankI: number,
    gate: [number, number],
  ): Array<[number, number]> => {
    const from = bank[bankI]!
    const leave = leaveToward(polylineTan(bank, bankI), from, gate)
    const arrive = nrm2(px - gate[0], py - gate[1])
    return smoothJoin(from, leave, gate, arrive, 6)
  }

  const nearestOn = (bank: ReadonlyArray<[number, number]>, x: number, y: number): { i: number; d: number } => {
    if (bank.length === 0) return { i: 0, d: Infinity }
    const i = closestIndex(bank, x, y)
    return { i, d: Math.hypot(bank[i]![0] - x, bank[i]![1] - y) }
  }

  let westArterial: Array<[number, number]> = []
  let eastArterial: Array<[number, number]> = []
  let approach: Array<[number, number]> = []
  const ci = closestIndex(openBank.length ? openBank : bankRoad, px, py)
  const closest = (openBank.length ? openBank : bankRoad)[ci]!
  const gateAng = Math.atan2(closest[1] - py, closest[0] - px)
  const riverGate = ringPoint(px, py, ringRoadR, gateAng)

  if (plazaOnBank && westBank.length >= 1) {
    const w = nearestOn(westBank, westJ[0], westJ[1])
    if (w.d <= maxSideJoin) {
      const join = joinBankToGate(westBank, westBank.length - 1, westJ)
      westArterial = westBank.length >= 2 ? [...westBank, ...join.slice(1)] : join
    } else {
      westArterial = westBank.length >= 2 ? [...westBank] : []
    }
  }
  if (plazaOnBank && eastBank.length >= 1) {
    const e = nearestOn(eastBank, eastJ[0], eastJ[1])
    if (e.d <= maxSideJoin) {
      const join = joinBankToGate(eastBank, 0, eastJ)
      eastArterial = eastBank.length >= 2
        ? [...join.slice().reverse(), ...eastBank.slice(1)]
        : join.slice().reverse()
    } else {
      eastArterial = eastBank.length >= 2 ? [...eastBank] : []
    }
  }

  const approachFrom = plazaOnBank
    ? (openBank.length ? openBank : bankRoad)
    : bankRoad
  const aci = closestIndex(approachFrom, riverGate[0], riverGate[1])
  const approachStart = approachFrom[aci]!
  const leave = leaveToward(polylineTan(approachFrom, aci), approachStart, riverGate)
  const arrive = nrm2(px - riverGate[0], py - riverGate[1])
  approach = smoothJoin(approachStart, leave, riverGate, arrive, 8)

  const arterialPoints: Array<[number, number]> = plazaOnBank
    ? [...westArterial, ...eastArterial, ...approach]
    : [...bankRoad, ...approach]

  let tx = -ny
  let ty = nx
  if (tx * (px - riverHit.x) + ty * (py - riverHit.y) > 0) {
    tx = -tx
    ty = -ty
  }
  const millPush = Math.max(18, plazaR + 16)
  let millPosition: [number, number] = [
    riverHit.x + tx * millPush + nx * (riverW * 0.5 + 3.4),
    riverHit.y + ty * millPush + ny * (riverW * 0.5 + 3.4),
  ]
  if (Math.hypot(millPosition[0] - px, millPosition[1] - py) < plazaR + 14) {
    millPosition = [
      riverHit.x - tx * millPush + nx * (riverW * 0.5 + 3.4),
      riverHit.y - ty * millPush + ny * (riverW * 0.5 + 3.4),
    ]
  }
  let millYaw = 1.57
  if (riverPts.length >= 2) {
    const millHit = closestOnPolyline(millPosition[0], millPosition[1], riverPts)
    millYaw = boxYawAlong(millHit.x - millPosition[0], millHit.y - millPosition[1])
  }

  const away = nrm2(px - riverHit.x, py - riverHit.y)
  const trailAng = Math.atan2(away[1], away[0])
  const trailJ = ringPoint(px, py, ringRoadR, trailAng)
  const trailPerp: [number, number] = [-away[1], away[0]]
  const trailLen = rayBudget(trailJ[0], trailJ[1], away[0], away[1], 31, 8, W - 8, 8, H - 8)
  const trailPoints: Array<[number, number]> = [0, 0.18, 0.40, 0.68, 1].map((u, i) => {
    const d = u * trailLen
    const w = Math.sin(i * 0.85) * Math.min(2.2, d * 0.07)
    return [trailJ[0] + away[0] * d + trailPerp[0] * w, trailJ[1] + away[1] * d + trailPerp[1] * w]
  })

  const feedAng = trailAng + 0.52
  const feedDir = nrm2(Math.cos(feedAng), Math.sin(feedAng))
  const feedJ = ringPoint(px, py, ringRoadR, feedAng)
  const feedPerp: [number, number] = [-feedDir[1], feedDir[0]]
  const feedLen = rayBudget(feedJ[0], feedJ[1], feedDir[0], feedDir[1], 29, 8, W - 8, 8, H - 8)
  const feederPoints: Array<[number, number]> = [0, 0.20, 0.44, 0.72, 1].map((u, i) => {
    const d = u * feedLen
    const w = Math.sin(i * 0.7) * Math.min(2.0, d * 0.06)
    return [feedJ[0] + feedDir[0] * d + feedPerp[0] * w, feedJ[1] + feedDir[1] * d + feedPerp[1] * w]
  })

  const millBankI = closestIndex(bankRoad, millPosition[0], millPosition[1])
  const millBank = bankRoad[millBankI]!
  const millLeave = leaveToward(polylineTan(bankRoad, millBankI), millBank, millPosition)
  const millArrive = nrm2(millPosition[0] - millBank[0], millPosition[1] - millBank[1])
  let millAccessPoints = smoothJoin(millBank, millLeave, millPosition, millArrive, 5)
  if (plazaOnBank) {
    const millGate = Math.hypot(westJ[0] - millPosition[0], westJ[1] - millPosition[1])
      < Math.hypot(eastJ[0] - millPosition[0], eastJ[1] - millPosition[1])
      ? westJ
      : eastJ
    if (Math.hypot(millGate[0] - millBank[0], millGate[1] - millBank[1]) < 22) {
      const gateJoin = joinBankToGate([millBank], 0, millGate)
      millAccessPoints = [...gateJoin.slice().reverse(), ...millAccessPoints.slice(1)]
    }
  }
  if (millAccessPoints.length < 3) {
    const mid: [number, number] = [
      (millAccessPoints[0]![0] + millPosition[0]) * 0.5,
      (millAccessPoints[0]![1] + millPosition[1]) * 0.5,
    ]
    millAccessPoints = [millAccessPoints[0]!, mid, millPosition]
  }
  const towerPosition: [number, number] = [px + 4.2, py - 4.2]

  const stopShort = (pts: Array<[number, number]>, atStart: boolean, atEnd: boolean, gap = 0.55): Array<[number, number]> => {
    if (pts.length < 2) return pts
    const out = pts.map((p) => [p[0], p[1]] as [number, number])
    if (atStart) {
      const a = out[0]!, b = out[1]!
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const t = Math.min(0.45, gap / len)
      out[0] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
    if (atEnd) {
      const a = out[out.length - 2]!, b = out[out.length - 1]!
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      const t = Math.min(0.45, gap / len)
      out[out.length - 1] = [b[0] - (b[0] - a[0]) * t, b[1] - (b[1] - a[1]) * t]
    }
    return out
  }

  const westMeetsRing = plazaOnBank && westArterial.length >= 2
    && Math.hypot(westArterial[westArterial.length - 1]![0] - westJ[0], westArterial[westArterial.length - 1]![1] - westJ[1]) < 1.2
  const eastMeetsRing = plazaOnBank && eastArterial.length >= 2
    && Math.hypot(eastArterial[0]![0] - eastJ[0], eastArterial[0]![1] - eastJ[1]) < 1.2
  const arterialEdges = [
    ...(plazaOnBank
      ? [
          ...(westArterial.length >= 2 ? [{ points: westMeetsRing ? stopShort(westArterial, false, true) : westArterial, width: 3.15, samplesPerSegment: 22 }] : []),
          ...(eastArterial.length >= 2 ? [{ points: eastMeetsRing ? stopShort(eastArterial, true, false) : eastArterial, width: 3.15, samplesPerSegment: 22 }] : []),
        ]
      : [{ points: bankRoad, width: 3.15, samplesPerSegment: 22 }]),
    ...(approach.length >= 2 ? [{ points: stopShort(approach, false, true), width: 3.15, samplesPerSegment: 22 }] : []),
  ]
  const junctions: Array<[number, number]> = [trailJ, feedJ, riverGate]
  if (westMeetsRing) junctions.push(westJ)
  if (eastMeetsRing) junctions.push(eastJ)

  const mesh = buildRoadNetworkMesh(
    [
      ...arterialEdges,
      { points: ringPoints, width: 2.9, closed: true, samplesPerSegment: 12 },
      { points: stopShort(trailPoints, true, false), width: 1.7, samplesPerSegment: 18 },
      { points: stopShort(feederPoints, true, false), width: 2.2, samplesPerSegment: 18 },
      { points: stopShort(millAccessPoints, true, false), width: 2.2, samplesPerSegment: 18 },
    ],
    junctions,
    { heightGrid: opts.heightGrid },
  )

  return {
    arterialPoints,
    ringPoints,
    trailPoints,
    feederPoints,
    millAccessPoints,
    towerPosition,
    millPosition,
    millYaw,
    bridgeStart,
    bridgeEnd,
    plazaCenter: [px, py],
    plazaRadius: plazaR,
    mesh,
  }
}

// ─── 9. PROCEDURAL VILLAGE LAYOUT GENERATOR ───────────────────────────────────

export interface ProceduralVillageLayoutOpts {
  readonly heightGrid: unknown
  readonly buildableMask?: unknown
  readonly valleyMask?: unknown
  readonly terraceMask?: unknown
  readonly forestMask?: unknown
  readonly slopeGrid?: unknown
  readonly roadPoints?: unknown
  readonly ringPoints?: unknown
  readonly trailPoints?: unknown
  readonly feederPoints?: unknown
  readonly millAccessPoints?: unknown
  readonly riverPoints?: unknown
  readonly plazaCenter?: unknown
  readonly plazaRadius?: number
  readonly towerPosition?: unknown
  readonly millPosition?: unknown
  readonly targetCount?: number
  readonly density?: number
  readonly seed?: number
  readonly cellSize?: number
  readonly roadWidth?: number
  readonly riverWidth?: number
  readonly roadSetback?: number
  readonly minSpacing?: number
}

function normalizePoints(raw: unknown): Vec2[] {
  if (!raw) return []
  let cur: unknown = raw
  if (cur && typeof cur === 'object' && 'items' in cur) {
    cur = (cur as { items: unknown }).items
  }
  if (cur && typeof cur === 'object' && !Array.isArray(cur) && 'x' in cur && 'y' in cur) {
    return [{ x: Number((cur as { x: unknown }).x), y: Number((cur as { y: unknown }).y) }]
  }
  if (!Array.isArray(cur)) return []
  if (cur.length >= 2 && typeof cur[0] === 'number' && typeof cur[1] === 'number') {
    return [{ x: Number(cur[0]), y: Number(cur[1]) }]
  }
  const out: Vec2[] = []
  for (const p of cur) {
    if (Array.isArray(p) && p.length >= 2) {
      out.push({ x: Number(p[0]), y: Number(p[1]) })
    } else if (p && typeof p === 'object' && 'x' in p && 'y' in p) {
      out.push({ x: Number((p as { x: unknown }).x), y: Number((p as { y: unknown }).y) })
    }
  }
  return out
}

/** Split a concatenated graph into edges. Village arterials use 12–16 m waypoints;
 *  the plaza jump is ~20 m (ring diameter). 18 m keeps the road and drops the chord. */
function splitPolylines(pts: Vec2[], maxGap = 18): Vec2[][] {
  if (pts.length < 2) return []
  const chains: Vec2[][] = []
  let cur: Vec2[] = [pts[0]!]
  for (let i = 1; i < pts.length; i++) {
    const prev = cur[cur.length - 1]!
    const p = pts[i]!
    if (Math.hypot(p.x - prev.x, p.y - prev.y) > maxGap) {
      if (cur.length >= 2) chains.push(cur)
      cur = [p]
    } else {
      cur.push(p)
    }
  }
  if (cur.length >= 2) chains.push(cur)
  return chains
}

function densifyCorridor(pts: readonly Vec2[], closed = false, samplesPerSegment = 16): Vec2[] {
  if (pts.length < 2) return pts.slice()
  let ctrl = dedupeControlPoints(pts.map((p) => [p.x, p.y] as [number, number]))
  if (ctrl.length < 2) return pts.slice()
  if (closed) {
    const a = ctrl[0]!, b = ctrl[ctrl.length - 1]!
    if (a[0] !== b[0] || a[1] !== b[1]) ctrl = [...ctrl, a]
  }
  if (ctrl.length === 2) {
    const a = ctrl[0]!, b = ctrl[1]!
    const n = Math.max(14, samplesPerSegment)
    const out: Vec2[] = []
    for (let i = 0; i <= n; i++) {
      const t = i / n
      out.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t })
    }
    return out
  }
  return sampleOpenSpline(ctrl, samplesPerSegment, 0.12, 0.88).map(([x, y]) => ({ x, y }))
}

/** Walk a densified polyline by arc length so short spline samples still get street lots. */
function walkArc(
  pts: readonly Vec2[],
  step: number,
  fn: (x: number, y: number, tx: number, ty: number) => void,
): void {
  if (pts.length < 2 || !(step > 0.4)) return
  let acc = 0
  let nextAt = step * 0.42
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-5) continue
    const dirX = dx / len, dirY = dy / len
    let consumed = 0
    let remain = len
    while (acc + remain >= nextAt - 1e-6) {
      const need = nextAt - acc
      const x = a.x + dirX * (consumed + need)
      const y = a.y + dirY * (consumed + need)
      fn(x, y, dirX, dirY)
      nextAt += step
      consumed += need
      remain -= need
      acc += need
    }
    acc += remain
  }
}

function footprintClearance(
  x: number,
  y: number,
  hw: number,
  hd: number,
  yaw: number,
  pts: readonly Vec2[],
): number {
  const cos = Math.cos(-yaw)
  const sin = Math.sin(-yaw)
  const samples: Array<[number, number]> = [
    [x, y],
    rotCorner(x, y, -hw, -hd, cos, sin, 1),
    rotCorner(x, y, hw, -hd, cos, sin, 1),
    rotCorner(x, y, hw, hd, cos, sin, 1),
    rotCorner(x, y, -hw, hd, cos, sin, 1),
    rotCorner(x, y, 0, -hd, cos, sin, 1),
    rotCorner(x, y, 0, hd, cos, sin, 1),
    rotCorner(x, y, -hw, 0, cos, sin, 1),
    rotCorner(x, y, hw, 0, cos, sin, 1),
  ]
  let min = Infinity
  for (const [sx, sy] of samples) {
    const d = distToSpline(sx, sy, pts)
    if (d < min) min = d
  }
  return min
}

function distToSpline(px: number, py: number, pts: readonly Vec2[]): number {
  if (pts.length === 0) return Infinity
  if (pts.length === 1) return Math.hypot(px - pts[0]!.x, py - pts[0]!.y)
  let minDist = Infinity
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i]!.x, ay = pts[i]!.y
    const bx = pts[i + 1]!.x, by = pts[i + 1]!.y
    const dx = bx - ax, dy = by - ay
    const l2 = dx * dx + dy * dy
    if (l2 < 1e-6) {
      const d = Math.hypot(px - ax, py - ay)
      if (d < minDist) minDist = d
      continue
    }
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
    const projX = ax + t * dx
    const projY = ay + t * dy
    const d = Math.hypot(px - projX, py - projY)
    if (d < minDist) minDist = d
  }
  return minDist
}

interface LayoutObb {
  x: number
  y: number
  hw: number
  hd: number
  yaw: number
}

function projectObb(obb: LayoutObb, ax: number, ay: number): [number, number] {
  const cos = Math.cos(-obb.yaw)
  const sin = Math.sin(-obb.yaw)
  const rx = cos * ax + sin * ay
  const ry = -sin * ax + cos * ay
  const ext = Math.abs(rx) * obb.hw + Math.abs(ry) * obb.hd
  const c = obb.x * ax + obb.y * ay
  return [c - ext, c + ext]
}

function obbOverlaps(a: LayoutObb, b: LayoutObb, gap: number): boolean {
  const paddedA: LayoutObb = { ...a, hw: a.hw + gap * 0.5, hd: a.hd + gap * 0.5 }
  const paddedB: LayoutObb = { ...b, hw: b.hw + gap * 0.5, hd: b.hd + gap * 0.5 }
  const axes: Array<[number, number]> = [
    [Math.cos(-a.yaw), Math.sin(-a.yaw)],
    [-Math.sin(-a.yaw), Math.cos(-a.yaw)],
    [Math.cos(-b.yaw), Math.sin(-b.yaw)],
    [-Math.sin(-b.yaw), Math.cos(-b.yaw)],
  ]
  for (const [ax, ay] of axes) {
    const [a0, a1] = projectObb(paddedA, ax, ay)
    const [b0, b1] = projectObb(paddedB, ax, ay)
    if (a1 < b0 || b1 < a0) return false
  }
  return true
}

function plotObb(plot: MultiTierHousePlot): LayoutObb {
  const fp = houseFootprint(plot.type)
  const scale = plot.scale ?? 1
  return {
    x: plot.x,
    y: plot.y,
    hw: fp.w * 0.5 * scale,
    hd: fp.d * 0.5 * scale,
    yaw: plot.yaw ?? 0,
  }
}

export function generateProceduralVillageLayout(opts: ProceduralVillageLayoutOpts): MultiTierHousePlot[] {
  const seed = Number(opts.seed ?? 33)
  const targetCount = Math.max(8, Math.min(120, Math.floor(opts.targetCount ?? 28)))
  const cellSize = Number(opts.cellSize ?? 1)
  const roadWidth = Number(opts.roadWidth ?? 3.2)
  const riverWidth = Number(opts.riverWidth ?? 8)
  const roadSetback = Number(opts.roadSetback ?? 2.2)
  const minSpacing = Number(opts.minSpacing ?? 2.4)
  const density = Math.max(0.35, Math.min(1.4, Number(opts.density ?? 1)))

  let s = (Math.abs(Math.floor(seed)) * 16807 + 1) % 2147483647
  function rand(): number {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }

  const roadPts = normalizePoints(opts.roadPoints)
  const ringPts = normalizePoints(opts.ringPoints)
  const trailPts = normalizePoints(opts.trailPoints)
  const feederPts = normalizePoints(opts.feederPoints)
  const millAccessPts = normalizePoints(opts.millAccessPoints)
  const riverPts = normalizePoints(opts.riverPoints)
  const plazaCenter = normalizePoints(opts.plazaCenter)[0] ?? null
  const plazaR = Number(opts.plazaRadius ?? 7.4)
  const tower = normalizePoints(opts.towerPosition)[0] ?? (plazaCenter ? { x: plazaCenter.x, y: plazaCenter.y - 0.8 } : null)
  const mill = normalizePoints(opts.millPosition)[0] ?? null

  const heightGrid = unwrapHeightGrid(opts.heightGrid)
  const gridW = heightGrid?.[0]?.length ?? 64
  const gridH = heightGrid?.length ?? 64
  const margin = Math.max(3, Math.min(6, Math.floor(Math.min(gridW, gridH) * 0.04)))

  // Half-widths match villageRoadNetwork ribbons plus spline/curb bulge so lots cannot sit on the deck.
  const arterialHalf = Math.max(2.05, roadWidth * 0.5 + 0.48)
  const corridors: Array<{ pts: Vec2[]; half: number; kind: 'road' | 'trail'; name: string }> = []
  for (const chain of splitPolylines(roadPts)) {
    corridors.push({ pts: densifyCorridor(chain, false, 16), half: arterialHalf, kind: 'road', name: 'arterial' })
  }
  if (ringPts.length >= 2) {
    corridors.push({ pts: densifyCorridor(ringPts, true, 8), half: Math.max(1.85, roadWidth * 0.45 + 0.4), kind: 'road', name: 'ring' })
  }
  if (feederPts.length >= 2) {
    corridors.push({ pts: densifyCorridor(feederPts, false, 14), half: Math.max(1.5, roadWidth * 0.35 + 0.4), kind: 'road', name: 'feeder' })
  }
  if (millAccessPts.length >= 2) {
    corridors.push({ pts: densifyCorridor(millAccessPts, false, 14), half: Math.max(1.5, roadWidth * 0.35 + 0.4), kind: 'road', name: 'mill' })
  }
  if (trailPts.length >= 2) {
    corridors.push({ pts: densifyCorridor(trailPts, false, 14), half: 1.25, kind: 'trail', name: 'trail' })
  }
  const riverLine = riverPts.length >= 2 ? densifyCorridor(riverPts, false, 16) : riverPts

  const junctions: Vec2[] = []
  if (plazaCenter) {
    const jr = plazaR + VILLAGE_RING_ROAD_OFFSET
    for (const ang of [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5, Math.PI * 0.28]) {
      junctions.push({ x: plazaCenter.x + Math.cos(ang) * jr, y: plazaCenter.y + Math.sin(ang) * jr })
    }
  }

  const civicR = plazaR + VILLAGE_RING_ROAD_OFFSET
  const marketR = civicR + roadWidth * 0.5 + roadSetback + 2.15
  const accepted: MultiTierHousePlot[] = []

  function distPlaza(x: number, y: number): number {
    return plazaCenter ? Math.hypot(x - plazaCenter.x, y - plazaCenter.y) : Infinity
  }

  function nearestCorridor(x: number, y: number): { dist: number; kind: 'road' | 'trail' } {
    let dist = Infinity
    let kind: 'road' | 'trail' = 'road'
    for (const c of corridors) {
      const d = distToSpline(x, y, c.pts)
      if (d < dist) {
        dist = d
        kind = c.kind
      }
    }
    return { dist, kind }
  }

  function tryPlace(
    x: number,
    y: number,
    type: HouseType,
    yaw: number,
    scale: number,
    district: string,
  ): boolean {
    if (accepted.length >= targetCount) return false
    if (x < margin || x > gridW - margin || y < margin || y > gridH - margin) return false

    const fp = houseFootprint(type)
    const hw = fp.w * 0.5 * scale
    const hd = fp.d * 0.5 * scale
    const reach = Math.hypot(hw, hd)

    if (distPlaza(x, y) < plazaR + 1.1 + Math.min(hw, hd)) return false
    if (tower && Math.hypot(x - tower.x, y - tower.y) < 3.6 + Math.min(hw, hd)) return false
    if (mill && Math.hypot(x - mill.x, y - mill.y) < 4.4 + Math.min(hw, hd)) return false
    for (const j of junctions) {
      if (Math.hypot(x - j.x, y - j.y) < 2.35 + Math.min(hw, hd) * 0.45) return false
    }

    if (riverLine.length > 0 && footprintClearance(x, y, hw, hd, yaw, riverLine) < riverWidth * 0.5 + 1.6) {
      return false
    }

    for (const c of corridors) {
      const pad = c.kind === 'trail' ? 0.28 : 0.42
      if (footprintClearance(x, y, hw, hd, yaw, c.pts) < c.half + pad) return false
    }

    const cos = Math.cos(-yaw)
    const sin = Math.sin(-yaw)
    const c0 = rotCorner(x, y, -hw, -hd, cos, sin, 1)
    const c1 = rotCorner(x, y, hw, -hd, cos, sin, 1)
    const c2 = rotCorner(x, y, hw, hd, cos, sin, 1)
    const c3 = rotCorner(x, y, -hw, hd, cos, sin, 1)
    const z0 = surfaceZ(opts.heightGrid, c0[0], c0[1], cellSize)
    const z1 = surfaceZ(opts.heightGrid, c1[0], c1[1], cellSize)
    const z2 = surfaceZ(opts.heightGrid, c2[0], c2[1], cellSize)
    const z3 = surfaceZ(opts.heightGrid, c3[0], c3[1], cellSize)
    const zC = surfaceZ(opts.heightGrid, x, y, cellSize)
    const maxDelta = district === 'plaza_market' ? 6.0 : district === 'town_center' ? 5.4 : 4.8
    if (Math.max(z0, z1, z2, z3, zC) - Math.min(z0, z1, z2, z3, zC) > maxDelta) return false

    const candidate: MultiTierHousePlot = {
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      yaw: Math.round(yaw * 100) / 100,
      type,
      scale: Math.round(scale * 100) / 100,
      district,
    }
    const box = plotObb(candidate)
    const gap = Math.max(1.15, minSpacing * (district === 'plaza_market' ? 0.72 : 1))
    for (const other of accepted) {
      if (obbOverlaps(box, plotObb(other), gap)) return false
      if (Math.hypot(candidate.x - other.x, candidate.y - other.y) < reach + 1.1) return false
    }

    accepted.push(candidate)
    return true
  }

  function placeFrontage(
    pts: readonly Vec2[],
    optsFront: {
      half: number
      step: number
      district: string
      innerCivic: boolean
      bothSides: boolean
    },
  ): void {
    if (pts.length < 2) return
    walkArc(pts, optsFront.step, (rx, ry, dirX, dirY) => {
      if (accepted.length >= targetCount) return
      const dPl = distPlaza(rx, ry)
      if (!optsFront.innerCivic && dPl < civicR + 1.55) return
      if (optsFront.innerCivic && dPl > marketR + 12) return
      if (junctions.some((j) => Math.hypot(rx - j.x, ry - j.y) < 3.05)) return

      const nearCore = dPl < plazaR + 20
      const type: HouseType = nearCore
        ? (rand() < 0.62 ? 'townhouse' : 'cottage')
        : (rand() < 0.4 ? 'chalet' : 'cottage')
      const fp = houseFootprint(type)
      const scale = nearCore ? 1.0 : 0.95
      const offset = optsFront.half + roadSetback + fp.d * 0.5 * scale
      const normX = -dirY, normY = dirX
      const sides = optsFront.bothSides ? [1, -1] : [1]
      for (const side of sides) {
        const x = rx + normX * offset * side
        const y = ry + normY * offset * side
        if (optsFront.innerCivic && distPlaza(x, y) < distPlaza(rx, ry)) continue
        let yaw = Math.atan2(-normY * side, -normX * side)
        if (riverLine.length >= 2) {
          const riverHit = closestOnPolyline(x, y, riverLine)
          const dRiver = Math.hypot(x - riverHit.x, y - riverHit.y)
          if (dRiver < riverWidth * 0.5 + 8.5) {
            yaw = Math.atan2(riverHit.y - y, riverHit.x - x)
          }
        }
        const nx = normX * side, ny = normY * side
        const tryStreet = (px: number, py: number, ty: HouseType, sc: number, distName: string): boolean => {
          const types: HouseType[] = ty === 'townhouse' ? ['townhouse', 'cottage', 'cabin'] : [ty, 'cottage', 'cabin']
          for (const cand of types) {
            if (tryPlace(px, py, cand, yaw, sc, distName)) return true
            for (const extra of [0.55, 1.05, 1.55, 2.15, -0.4]) {
              if (tryPlace(px + nx * extra, py + ny * extra, cand, yaw, sc, distName)) return true
            }
          }
          return false
        }
        tryStreet(x, y, type, scale, optsFront.district)
        if (optsFront.district === 'town_center') {
          const backType: HouseType = nearCore ? (rand() < 0.5 ? 'cottage' : 'chalet') : (rand() < 0.5 ? 'chalet' : 'cabin')
          const backFp = houseFootprint(backType)
          const back = offset + backFp.d * 0.5 + minSpacing * 0.75 + 0.85
          tryStreet(rx + nx * back, ry + ny * back, backType, nearCore ? 0.96 : 0.92, 'town_center')
        }
      }
    })
  }

  // 1. Civic market first — depends on plaza + ring road, leaves junction gates open.
  if (plazaCenter) {
    const slots = Math.max(16, Math.round(18 * density))
    for (let i = 0; i < slots; i++) {
      const base = (i / slots) * Math.PI * 2 + 0.19
      let placed = false
      for (const dang of [0, 0.13, -0.13, 0.24, -0.24]) {
        const angle = base + dang
        if ([0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5].some((g) => angleNear(angle, g, 0.10))) continue
        const yaw = Math.atan2(-Math.sin(angle), -Math.cos(angle))
        const radii = Math.sin(angle) < -0.1 ? [marketR + 1.4, marketR + 2.3] : [marketR, marketR + 1.05, marketR + 1.9]
        for (const r of radii) {
          const x = plazaCenter.x + Math.cos(angle) * r
          const y = plazaCenter.y + Math.sin(angle) * r
          if (tryPlace(x, y, 'townhouse', yaw, 1.04, 'plaza_market')) {
            placed = true
            break
          }
        }
        if (placed) break
      }
    }
    const outerR = marketR + 5.1
    const outerSlots = Math.max(12, Math.round(14 * density))
    for (let i = 0; i < outerSlots; i++) {
      const angle = (i / outerSlots) * Math.PI * 2 + 0.31
      if ([0, Math.PI].some((g) => angleNear(angle, g, 0.28))) continue
      if ([Math.PI * 0.5, -Math.PI * 0.5].some((g) => angleNear(angle, g, 0.16))) continue
      const x = plazaCenter.x + Math.cos(angle) * outerR
      const y = plazaCenter.y + Math.sin(angle) * outerR
      const yaw = Math.atan2(plazaCenter.y - y, plazaCenter.x - x)
      tryPlace(x, y, rand() < 0.6 ? 'cottage' : 'chalet', yaw, 0.98, 'town_center')
    }
  }

  // 2. Street frontage along the plaza-dependent road graph (use draped curves, not chords).
  for (const chain of corridors) {
    if (chain.name === 'ring') {
      placeFrontage(chain.pts, { half: chain.half, step: 4.9 / density, district: 'town_center', innerCivic: true, bothSides: true })
      continue
    }
    if (chain.name === 'trail') {
      placeFrontage(chain.pts, { half: chain.half, step: 5.4 / density, district: 'trailside', innerCivic: false, bothSides: true })
      continue
    }
    const district = chain.name === 'mill' ? 'riverfront' : 'town_center'
    placeFrontage(chain.pts, {
      half: chain.half,
      step: (chain.name === 'mill' ? 4.8 : 4.7) / density,
      district,
      innerCivic: false,
      bothSides: true,
    })
  }

  // 3. Hillside fill in the residential belt: outside civic core, near the network, off the ribbon.
  // Prioritize sunny southern valley slopes and terraced meadows (y >= gridH * 0.44).
  const scanY0 = gridH * 0.44
  const scanY1 = gridH * 0.93
  const scanX0 = gridW * 0.07
  const scanX1 = gridW * 0.93
  const stepY = (gridH >= 96 ? 3.15 : 2.7) / density
  const stepX = (gridW >= 96 ? 3.15 : 2.7) / density
  for (let gy = scanY0; gy <= scanY1 && accepted.length < targetCount; gy += stepY) {
    for (let gx = scanX0; gx <= scanX1; gx += stepX) {
      const jx = gx + (rand() - 0.5) * 2.1
      const jy = gy + (rand() - 0.5) * 2.1
      const dPl = distPlaza(jx, jy)
      if (dPl < marketR + 3.2) continue
      const near = nearestCorridor(jx, jy)
      if (near.dist < arterialHalf + 3.4 || near.dist > 22) continue
      const zL = surfaceZ(opts.heightGrid, jx - 1, jy, cellSize)
      const zR = surfaceZ(opts.heightGrid, jx + 1, jy, cellSize)
      const zD = surfaceZ(opts.heightGrid, jx, jy - 1, cellSize)
      const zU = surfaceZ(opts.heightGrid, jx, jy + 1, cellSize)
      const dzdx = (zR - zL) * 0.5
      const dzdy = (zU - zD) * 0.5
      const slopeLen = Math.hypot(dzdx, dzdy)
      const yaw = slopeLen > 0.08
        ? Math.atan2(-dzdx, dzdy)
        : (plazaCenter ? Math.atan2(plazaCenter.x - jx, -(plazaCenter.y - jy)) : 0)
      const type: HouseType = dPl > plazaR + 30
        ? (rand() < 0.42 ? 'cabin' : 'cottage')
        : (rand() < 0.5 ? 'chalet' : 'cottage')
      if (!tryPlace(jx, jy, type, yaw, 0.94, 'terraced_hillside')) {
        tryPlace(jx, jy, 'cabin', yaw, 0.9, 'terraced_hillside')
      }
    }
  }

  // 4. Farmsteads at the far ends of feeders / trail — still attached to the network.
  const farmAnchors: Vec2[] = []
  if (feederPts.length > 0) farmAnchors.push(feederPts[feederPts.length - 1]!)
  if (trailPts.length > 0) farmAnchors.push(trailPts[trailPts.length - 1]!)
  for (const chain of splitPolylines(roadPts)) {
    farmAnchors.push(chain[0]!, chain[chain.length - 1]!)
  }
  for (const anchor of farmAnchors) {
    if (accepted.length >= targetCount) break
    if (distPlaza(anchor.x, anchor.y) < plazaR + 22) continue
    let placedFarm = false
    for (let k = 0; k < 8 && !placedFarm; k++) {
      const yaw = rand() * Math.PI * 2
      const dist = 6.4 + rand() * 3.2
      const fx = anchor.x + Math.cos(yaw) * dist
      const fy = anchor.y + Math.sin(yaw) * dist
      if (tryPlace(fx, fy, 'farmhouse', yaw, 1.06, 'farmstead')) {
        tryPlace(fx + Math.cos(yaw + 1.15) * 7.6, fy + Math.sin(yaw + 1.15) * 7.6, 'barn', yaw + 0.3, 0.98, 'farmstead')
        placedFarm = true
      }
    }
  }

  return accepted.slice(0, targetCount)
}

// ─── 10. PROCEDURAL ALPINE SCENE PROPS & STORYTELLING DECORATIONS ────────────

export interface AlpineScenePropsOpts {
  readonly heightGrid?: unknown
  readonly slopeGrid?: unknown
  readonly terraceMask?: unknown
  readonly forestMask?: unknown
  readonly roadPoints?: unknown
  readonly ringPoints?: unknown
  readonly trailPoints?: unknown
  readonly feederPoints?: unknown
  readonly millAccessPoints?: unknown
  readonly riverPoints?: unknown
  readonly plazaCenter?: unknown
  readonly plazaRadius?: number
  readonly bridgeStart?: unknown
  readonly bridgeEnd?: unknown
  readonly towerPosition?: unknown
  readonly millPosition?: unknown
  readonly avoidPoints?: unknown
  readonly seed?: number
  readonly cellSize?: number
  readonly riverWidth?: number
}

export function buildAlpineScenePropsMesh(opts: AlpineScenePropsOpts): SceneMesh | null {
  const cellSize = Number(opts.cellSize ?? 1)
  const seed = Number(opts.seed ?? 42)
  let s = (Math.abs(Math.floor(seed)) * 16807 + 1) % 2147483647
  function rand(): number {
    s = (s * 16807) % 2147483646
    return (s - 1) / 2147483646
  }

  const roadPts = normalizePoints(opts.roadPoints)
  const ringPts = normalizePoints(opts.ringPoints)
  const trailPts = normalizePoints(opts.trailPoints)
  const feederPts = normalizePoints(opts.feederPoints)
  const millAccessPts = normalizePoints(opts.millAccessPoints)
  const riverPts = normalizePoints(opts.riverPoints)
  const plazaCenter = normalizePoints(opts.plazaCenter)[0] ?? null
  const plazaR = Number(opts.plazaRadius ?? 7.4)
  const bridgeStart = normalizePoints(opts.bridgeStart)[0] ?? null
  const bridgeEnd = normalizePoints(opts.bridgeEnd)[0] ?? null
  const mill = normalizePoints(opts.millPosition)[0] ?? null
  const avoid = normalizePoints(opts.avoidPoints)
  const riverW = Number(opts.riverWidth ?? 8)

  const heightGrid = unwrapHeightGrid(opts.heightGrid)
  const gridW = heightGrid?.[0]?.length ?? 64
  const gridH = heightGrid?.length ?? 64

  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []
  const colors: number[] = []

  function isNearAvoid(x: number, y: number, radius = 3.2): boolean {
    for (const p of avoid) {
      if (Math.hypot(x - p.x, y - p.y) < radius) return true
    }
    return false
  }

  // 1. Continuous village-side quay: consecutive bank segments, length along the river.
  const villageToward = plazaCenter ?? mill ?? { x: gridW * 0.56, y: gridH * 0.52 }
  const bankOff = riverW * 0.5 + 0.32
  const roadSpline = [...roadPts, ...millAccessPts, ...feederPts, ...ringPts]
  const bridgeMid = bridgeStart && bridgeEnd
    ? { x: (bridgeStart.x + bridgeEnd.x) * 0.5, y: (bridgeStart.y + bridgeEnd.y) * 0.5 }
    : null
  if (riverPts.length >= 2) {
    const dRiver = densifyCorridor(riverPts, false, 32)
    const tagged = new Array<boolean>(dRiver.length).fill(false)
    for (let i = 0; i < dRiver.length; i++) {
      const a = dRiver[Math.max(0, i - 1)]!
      const b = dRiver[Math.min(dRiver.length - 1, i + 1)]!
      const dx = b.x - a.x, dy = b.y - a.y
      const len = Math.hypot(dx, dy) || 1
      const n = landwardNormal(-dy / len, dx / len, dRiver[i]!.x, dRiver[i]!.y, villageToward.x, villageToward.y)
      const bx = dRiver[i]!.x + n.nx * bankOff
      const by = dRiver[i]!.y + n.ny * bankOff
      const nearRoad = roadSpline.length >= 2 && distToSpline(bx, by, roadSpline) < 18
      const nearPlaza = Math.hypot(dRiver[i]!.x - villageToward.x, dRiver[i]!.y - villageToward.y) < plazaR + 38
      if (nearRoad || nearPlaza) tagged[i] = true
    }
    for (let pass = 0; pass < 3; pass++) {
      const next = tagged.slice()
      for (let i = 0; i < tagged.length; i++) {
        if (tagged[i]) continue
        if ((i > 0 && tagged[i - 1]) || (i < tagged.length - 1 && tagged[i + 1])) next[i] = true
      }
      for (let i = 0; i < tagged.length; i++) tagged[i] = next[i]!
    }

    let quayArc = 0
    for (let i = 0; i < dRiver.length - 1; i++) {
      if (!tagged[i] || !tagged[i + 1]) continue
      const a = dRiver[i]!, b = dRiver[i + 1]!
      const dx = b.x - a.x, dy = b.y - a.y
      const len = Math.hypot(dx, dy)
      if (len < 0.12) continue
      const tx = dx / len, ty = dy / len
      const midX = (a.x + b.x) * 0.5
      const midY = (a.y + b.y) * 0.5
      const n = landwardNormal(-ty, tx, midX, midY, villageToward.x, villageToward.y)
      const mx = midX + n.nx * bankOff
      const my = midY + n.ny * bankOff
      if (bridgeMid && Math.hypot(mx - bridgeMid.x, my - bridgeMid.y) < 4.6) {
        quayArc += len
        continue
      }
      const yaw = boxYawAlong(dx, dy)
      const segW = len + 0.22
      const zBank = surfaceZ(opts.heightGrid, mx, my, cellSize)
      const zWaterSeg = surfaceZ(opts.heightGrid, midX, midY, cellSize)
      const revetH = Math.max(0.6, zBank - zWaterSeg + 0.4)
      pushRotBox(positions, indices, normals, colors, mx, my, zWaterSeg + revetH * 0.5, segW, 1.18, revetH, yaw, QUAY_STONE_COLOR, cellSize)
      pushRotBox(positions, indices, normals, colors, mx, my, zBank + 0.55, segW * 0.96, 0.08, 0.08, yaw, RUSTIC_FENCE_COLOR, cellSize)
      pushRotBox(positions, indices, normals, colors, mx, my, zBank + 0.95, segW * 0.96, 0.08, 0.08, yaw, RUSTIC_FENCE_COLOR, cellSize)

      const prevArc = quayArc
      quayArc += len
      if (Math.floor(quayArc / 2.35) !== Math.floor(prevArc / 2.35)) {
        const px = mx + tx * (segW * 0.42)
        const py = my + ty * (segW * 0.42)
        pushCylinder(positions, indices, normals, colors, px, py, zBank, zBank + 1.1, 0.08, 0.08, 6, RUSTIC_FENCE_COLOR, cellSize)
      }
      if (Math.floor(quayArc / 7.4) !== Math.floor(prevArc / 7.4)) {
        for (let st = 0; st < 3; st++) {
          const sx = mx - n.nx * (st * 0.4 + 0.6)
          const sy = my - n.ny * (st * 0.4 + 0.6)
          const sz = zBank - (st + 1) * (revetH * 0.3)
          pushRotBox(positions, indices, normals, colors, sx, sy, sz, 1.8, 0.45, 0.22, yaw, QUAY_STONE_COLOR, cellSize)
        }
      }
    }
  }

  // 2. Fishing jetty on the village bank, deck extending into the water beside the bridge.
  let pierX = 50, pierY = 56, pierYaw = -0.15
  if (riverPts.length >= 2) {
    const pCand = densifyCorridor(riverPts, false, 32)
    let bestI = 0
    let bestScore = -Infinity
    for (let i = 0; i < pCand.length; i++) {
      const p = pCand[i]!
      if (bridgeMid && Math.hypot(p.x - bridgeMid.x, p.y - bridgeMid.y) < 7.2) continue
      const dPlaza = Math.hypot(p.x - villageToward.x, p.y - villageToward.y)
      const score = -dPlaza
      if (score > bestScore) {
        bestScore = score
        bestI = i
      }
    }
    const p = pCand[bestI]!
    const a = pCand[Math.max(0, bestI - 1)]!
    const b = pCand[Math.min(pCand.length - 1, bestI + 1)]!
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const n = landwardNormal(-dy / len, dx / len, p.x, p.y, villageToward.x, villageToward.y)
    pierX = p.x + n.nx * bankOff
    pierY = p.y + n.ny * bankOff
    // Pier local +Y is (sin(yaw), cos(yaw)); point it into the water (-landward).
    pierYaw = Math.atan2(-n.nx, -n.ny)
  }
  const zPierLand = surfaceZ(opts.heightGrid, pierX, pierY, cellSize)
  const zWater = zPierLand - 0.85
  const pierL = 4.4, pierW = 2.4
  const cosP = Math.cos(-pierYaw), sinP = Math.sin(-pierYaw)
  const pierDeckZ = zWater + 0.55

  // 6 Wooden Piling Posts
  for (const [lx, ly] of [[-pierW * 0.4, 0.5], [pierW * 0.4, 0.5], [-pierW * 0.4, pierL * 0.5], [pierW * 0.4, pierL * 0.5], [-pierW * 0.4, pierL], [pierW * 0.4, pierL]]) {
    const px = pierX + lx * cosP - ly * sinP
    const py = pierY + lx * sinP + ly * cosP
    pushCylinder(positions, indices, normals, colors, px, py, zWater - 1.2, pierDeckZ + 0.35, 0.15, 0.15, 6, WOOD_BARREL_COLOR, cellSize)
  }
  // Pier Deck Planks
  const rotPier = (lx: number, ly: number, lz: number): [number, number, number] => [
    (pierX + lx * cosP - ly * sinP) * cellSize,
    -(pierY + lx * sinP + ly * cosP) * cellSize,
    pierDeckZ + lz,
  ]
  pushQuad(positions, indices, normals, rotPier(-pierW * 0.5, 0, 0), rotPier(pierW * 0.5, 0, 0), rotPier(pierW * 0.5, pierL, 0), rotPier(-pierW * 0.5, pierL, 0), [0, 0, 1], colors, WOOD_PLANK_COLOR)

  // Mooring Bollards, Fish Barrels & Crates on Pier
  const bolX = pierX + (pierW * 0.4) * cosP - (pierL * 0.9) * sinP
  const bolY = pierY + (pierW * 0.4) * sinP + (pierL * 0.9) * cosP
  pushCylinder(positions, indices, normals, colors, bolX, bolY, pierDeckZ, pierDeckZ + 0.45, 0.12, 0.12, 6, WOOD_PLANK_COLOR, cellSize)
  const pBarX = pierX + (-pierW * 0.25) * cosP - (pierL * 0.6) * sinP
  const pBarY = pierY + (-pierW * 0.25) * sinP + (pierL * 0.6) * cosP
  pushCylinder(positions, indices, normals, colors, pBarX, pBarY, pierDeckZ, pierDeckZ + 0.65, 0.28, 0.28, 6, WOOD_BARREL_COLOR, cellSize)
  const pCrtX = pierX + (-pierW * 0.25) * cosP - (pierL * 0.3) * sinP
  const pCrtY = pierY + (-pierW * 0.25) * sinP + (pierL * 0.3) * cosP
  pushRotBox(positions, indices, normals, colors, pCrtX, pCrtY, pierDeckZ + 0.25, 0.55, 0.55, 0.5, pierYaw, WOOD_CRATE_COLOR, cellSize)

  // Moored Wooden Rowboat
  const boatX = pierX + (pierW * 0.5 + 1.2) * cosP - (pierL * 0.5) * sinP
  const boatY = pierY + (pierW * 0.5 + 1.2) * sinP + (pierL * 0.5) * cosP
  const boatZ = zWater + 0.05
  const bL = 3.2, bW = 1.3, bH = 0.55
  pushRotBox(positions, indices, normals, colors, boatX, boatY, boatZ + bH * 0.3, bW, bL, bH, pierYaw, WOOD_BARREL_COLOR, cellSize)
  pushRotBox(positions, indices, normals, colors, boatX, boatY, boatZ + bH * 0.4, bW * 0.7, 0.35, 0.08, pierYaw, WOOD_PLANK_COLOR, cellSize)

  // 3. HIGH MOUNTAIN SUMMIT CROSS (Gipfelkreuz) & RIDGE LOOKOUT
  let summitX = 24, summitY = 28
  if (trailPts.length > 0) {
    let maxZ = -Infinity
    for (const tp of trailPts) {
      const z = surfaceZ(opts.heightGrid, tp.x, tp.y, cellSize)
      if (z > maxZ) {
        maxZ = z; summitX = tp.x; summitY = tp.y
      }
    }
  }
  const zSummit = surfaceZ(opts.heightGrid, summitX, summitY, cellSize)
  // Stepped stone plinth base
  pushCylinder(positions, indices, normals, colors, summitX, summitY, zSummit - 0.5, zSummit + 0.4, 1.4, 1.1, 8, MOUNTAIN_CAIRN_COLOR, cellSize)
  pushCylinder(positions, indices, normals, colors, summitX, summitY, zSummit + 0.4, zSummit + 0.9, 1.0, 0.75, 8, MOUNTAIN_CAIRN_COLOR, cellSize)

  // Tall Alpine Wooden Cross (Gipfelkreuz)
  const crossH = 4.6, crossW = 2.6
  const crossZ = zSummit + 0.9
  pushRotBox(positions, indices, normals, colors, summitX, summitY, crossZ + crossH * 0.5, 0.32, 0.32, crossH, 0, MOUNTAIN_CROSS_COLOR, cellSize)
  pushRotBox(positions, indices, normals, colors, summitX, summitY, crossZ + crossH * 0.72, crossW, 0.28, 0.28, 0, MOUNTAIN_CROSS_COLOR, cellSize)
  // Octagonal Brass Halo Ring
  const haloR = 0.75
  const haloZ = crossZ + crossH * 0.72
  for (let h = 0; h < 8; h++) {
    const a0 = (h / 8) * Math.PI * 2, a1 = ((h + 1) / 8) * Math.PI * 2
    const hb0 = [(summitX + Math.cos(a0) * haloR) * cellSize, -summitY * cellSize, haloZ + Math.sin(a0) * haloR] as [number, number, number]
    const hb1 = [(summitX + Math.cos(a1) * haloR) * cellSize, -summitY * cellSize, haloZ + Math.sin(a1) * haloR] as [number, number, number]
    const ht0 = [(summitX + Math.cos(a0) * haloR) * cellSize, (-summitY - 0.08) * cellSize, haloZ + Math.sin(a0) * haloR] as [number, number, number]
    const ht1 = [(summitX + Math.cos(a1) * haloR) * cellSize, (-summitY - 0.08) * cellSize, haloZ + Math.sin(a1) * haloR] as [number, number, number]
    pushQuad(positions, indices, normals, hb0, hb1, ht1, ht0, undefined, colors, MARKET_CANOPY_GOLD)
  }
  // Summit Panoramic View Bench
  const bchX = summitX + 1.6, bchY = summitY + 1.2
  const zBch = surfaceZ(opts.heightGrid, bchX, bchY, cellSize)
  pushRotBox(positions, indices, normals, colors, bchX, bchY, zBch + 0.45, 1.8, 0.45, 0.1, 0.5, WOOD_PLANK_COLOR, cellSize)
  pushRotBox(positions, indices, normals, colors, bchX - 0.6, bchY, zBch + 0.22, 0.15, 0.35, 0.44, 0.5, WOOD_PLANK_COLOR, cellSize)
  pushRotBox(positions, indices, normals, colors, bchX + 0.6, bchY, zBch + 0.22, 0.15, 0.35, 0.44, 0.5, WOOD_PLANK_COLOR, cellSize)

  // 4. HIGH ALPINE REFUGE STONE SHELTER (Bivouac Hut on Mountain Pass / Ridge)
  let hutX = 36, hutY = 24, hutFound = false
  for (let gy = 16; gy <= 32; gy += 4) {
    for (let gx = 20; gx <= 44; gx += 4) {
      const gz = surfaceZ(opts.heightGrid, gx, gy, cellSize)
      if (gz >= 22 && gz <= 38 && !isNearAvoid(gx, gy, 5.0)) {
        hutX = gx; hutY = gy; hutFound = true; break
      }
    }
    if (hutFound) break
  }
  const zHut = surfaceZ(opts.heightGrid, hutX, hutY, cellSize)
  const hutW = 4.0, hutD = 3.2, hutH = 2.4, hutRoofH = 1.6
  pushRotBox(positions, indices, normals, colors, hutX, hutY, zHut + hutH * 0.5, hutW, hutD, hutH, 0.35, REFUGE_STONE_COLOR, cellSize)
  pushRotBox(positions, indices, normals, colors, hutX + 0.8, hutY - 1.62, zHut + 0.9, 0.85, 0.15, 1.6, 0.35, WOOD_PLANK_COLOR, cellSize)
  const cosH = Math.cos(-0.35), sinH = Math.sin(-0.35)
  const rHutApex0 = [(hutX - (hutW * 0.55) * cosH) * cellSize, -(hutY - (hutW * 0.55) * sinH) * cellSize, zHut + hutH + hutRoofH] as [number, number, number]
  const rHutApex1 = [(hutX + (hutW * 0.55) * cosH) * cellSize, -(hutY + (hutW * 0.55) * sinH) * cellSize, zHut + hutH + hutRoofH] as [number, number, number]
  const rHutEave0 = [(hutX - (hutW * 0.55) * cosH - (hutD * 0.6) * sinH) * cellSize, -(hutY - (hutW * 0.55) * sinH + (hutD * 0.6) * cosH) * cellSize, zHut + hutH] as [number, number, number]
  const rHutEave1 = [(hutX + (hutW * 0.55) * cosH - (hutD * 0.6) * sinH) * cellSize, -(hutY + (hutW * 0.55) * sinH + (hutD * 0.6) * cosH) * cellSize, zHut + hutH] as [number, number, number]
  const rHutEave2 = [(hutX + (hutW * 0.55) * cosH + (hutD * 0.6) * sinH) * cellSize, -(hutY + (hutW * 0.55) * sinH - (hutD * 0.6) * cosH) * cellSize, zHut + hutH] as [number, number, number]
  const rHutEave3 = [(hutX - (hutW * 0.55) * cosH + (hutD * 0.6) * sinH) * cellSize, -(hutY - (hutW * 0.55) * sinH - (hutD * 0.6) * cosH) * cellSize, zHut + hutH] as [number, number, number]
  pushQuad(positions, indices, normals, rHutEave0, rHutEave1, rHutApex1, rHutApex0, undefined, colors, REFUGE_ROOF_COLOR)
  pushQuad(positions, indices, normals, rHutApex0, rHutApex1, rHutEave2, rHutEave3, undefined, colors, REFUGE_ROOF_COLOR)
  pushRotBox(positions, indices, normals, colors, hutX - 1.2, hutY + 0.8, zHut + hutH + 1.2, 0.65, 0.65, 1.8, 0.35, REFUGE_STONE_COLOR, cellSize)
  pushRotBox(positions, indices, normals, colors, hutX + 2.4, hutY + 0.4, zHut + 0.6, 1.2, 2.0, 1.2, 0.35, WOOD_BARREL_COLOR, cellSize)

  // 5. MOUNTAIN SIGNAL BEACON & WEATHER VANE ON SECONDARY RIDGE
  const beaconX = 104, beaconY = 32
  const zBeacon = surfaceZ(opts.heightGrid, beaconX, beaconY, cellSize)
  pushCylinder(positions, indices, normals, colors, beaconX, beaconY, zBeacon, zBeacon + 1.2, 1.6, 1.3, 8, MOUNTAIN_CAIRN_COLOR, cellSize)
  pushRotBox(positions, indices, normals, colors, beaconX, beaconY, zBeacon + 1.8, 1.4, 1.4, 1.2, 0, RUSTIC_FENCE_COLOR, cellSize)
  pushCylinder(positions, indices, normals, colors, beaconX, beaconY, zBeacon + 2.4, zBeacon + 4.8, 0.08, 0.06, 6, WOOD_PLANK_COLOR, cellSize)
  pushRotBox(positions, indices, normals, colors, beaconX + 0.35, beaconY, zBeacon + 4.6, 0.75, 0.05, 0.22, 0.8, MARKET_CANOPY_GOLD, cellSize)

  // 6. MOUNTAIN SCREE & TALUS BOULDER CHUTES (Flows downhill along slope gradient)
  for (let k = 0; k < 42; k++) {
    const rx = 10 + rand() * (gridW - 20)
    const ry = 6 + rand() * (gridH * 0.30)
    const rz = surfaceZ(opts.heightGrid, rx, ry, cellSize)
    if (rz < 22) continue
    if (isNearAvoid(rx, ry, 3.5)) continue

    const bSize = 0.8 + rand() * 1.5
    const bH = 0.6 + rand() * 1.0
    const bYaw = rand() * Math.PI * 2
    pushRotBox(positions, indices, normals, colors, rx, ry, rz + bH * 0.35, bSize, bSize * (0.7 + rand() * 0.5), bH, bYaw, BOULDER_ROCK_COLOR, cellSize)
  }

  // 7. MOUNTAIN TRAIL CAIRNS & WAYMARKERS (Steinmännchen along trail)
  if (trailPts.length >= 2) {
    const dTrail = densifyCorridor(trailPts, false, 12)
    walkArc(dTrail, 12, (tx, ty) => {
      if (Math.hypot(tx - summitX, ty - summitY) < 5.0) return
      const tz = surfaceZ(opts.heightGrid, tx, ty, cellSize)
      pushCylinder(positions, indices, normals, colors, tx + 0.8, ty + 0.8, tz, tz + 0.25, 0.6, 0.5, 6, MOUNTAIN_CAIRN_COLOR, cellSize)
      pushCylinder(positions, indices, normals, colors, tx + 0.82, ty + 0.8, tz + 0.25, tz + 0.5, 0.45, 0.38, 6, MOUNTAIN_CAIRN_COLOR, cellSize)
      pushCylinder(positions, indices, normals, colors, tx + 0.8, ty + 0.82, tz + 0.5, tz + 0.72, 0.32, 0.25, 6, MOUNTAIN_CAIRN_COLOR, cellSize)
      pushCylinder(positions, indices, normals, colors, tx + 0.8, ty + 0.8, tz + 0.72, tz + 0.95, 0.18, 0.1, 5, MOUNTAIN_CAIRN_COLOR, cellSize)
    })
  }

  // 8. WAYSIDE SHRINE / CRUCIFIX (Wegkreuz at mountain trail switchback)
  if (trailPts.length >= 3) {
    const sw = trailPts[Math.floor(trailPts.length * 0.45)]!
    const zSw = surfaceZ(opts.heightGrid, sw.x, sw.y, cellSize)
    pushRotBox(positions, indices, normals, colors, sw.x + 1.2, sw.y + 1.2, zSw + 0.4, 0.8, 0.8, 0.8, 0.3, MOUNTAIN_CAIRN_COLOR, cellSize)
    pushRotBox(positions, indices, normals, colors, sw.x + 1.2, sw.y + 1.2, zSw + 1.4, 0.65, 0.45, 1.2, 0.3, WOOD_PLANK_COLOR, cellSize)
    pushRotBox(positions, indices, normals, colors, sw.x + 1.2, sw.y + 1.2, zSw + 2.15, 0.9, 0.65, 0.3, 0.3, HOUSE_ROOF_COLOR, cellSize)
    pushRotBox(positions, indices, normals, colors, sw.x + 1.2, sw.y + 1.05, zSw + 1.45, 0.12, 0.05, 0.55, 0.3, MARKET_CANOPY_GOLD, cellSize)
  }

  // 9. TIMBER AVALANCHE & ROCKFALL CRIBBING (Along trail below cliffs)
  if (trailPts.length >= 4) {
    const tb = trailPts[Math.floor(trailPts.length * 0.7)]!
    const zTb = surfaceZ(opts.heightGrid, tb.x, tb.y, cellSize)
    for (let p = -2; p <= 2; p++) {
      const px = tb.x + p * 1.4
      const py = tb.y - 1.8
      const pz = surfaceZ(opts.heightGrid, px, py, cellSize)
      pushCylinder(positions, indices, normals, colors, px, py, pz, pz + 1.8, 0.12, 0.12, 6, RUSTIC_FENCE_COLOR, cellSize)
    }
    pushRotBox(positions, indices, normals, colors, tb.x, tb.y - 1.8, zTb + 0.6, 6.0, 0.12, 0.15, 0, RUSTIC_FENCE_COLOR, cellSize)
    pushRotBox(positions, indices, normals, colors, tb.x, tb.y - 1.8, zTb + 1.2, 6.0, 0.12, 0.15, 0, RUSTIC_FENCE_COLOR, cellSize)
  }

  // 10. PROCEDURAL HAYSTACKS (Heuschober) & PASTURE FENCES (Agricultural Terraces)
  const pastureLocations: Vec2[] = []
  for (let gy = 70; gy <= 100; gy += 8) {
    for (let gx = 30; gx <= 110; gx += 12) {
      const zG = surfaceZ(opts.heightGrid, gx, gy, cellSize)
      if (zG >= 6 && zG <= 22 && !isNearAvoid(gx, gy, 4.5) && distToSpline(gx, gy, roadPts) > 5) {
        pastureLocations.push({ x: gx, y: gy })
      }
    }
  }

  for (const pl of pastureLocations.slice(0, 6)) {
    const hz = surfaceZ(opts.heightGrid, pl.x, pl.y, cellSize)
    pushCylinder(positions, indices, normals, colors, pl.x, pl.y, hz, hz + 2.2, 1.5, 0.25, 8, HAYSTACK_COLOR, cellSize)
    pushCylinder(positions, indices, normals, colors, pl.x, pl.y, hz + 2.0, hz + 3.1, 0.08, 0.06, 6, WOOD_PLANK_COLOR, cellSize)

    const fL = 6.4, fYaw = rand() * Math.PI
    const cosF = Math.cos(-fYaw), sinF = Math.sin(-fYaw)
    for (let p = 0; p <= 2; p++) {
      const fx = pl.x + (p * 3.0 - 3.0) * cosF
      const fy = pl.y + (p * 3.0 - 3.0) * sinF
      const fz = surfaceZ(opts.heightGrid, fx, fy, cellSize)
      pushCylinder(positions, indices, normals, colors, fx, fy, fz, fz + 1.2, 0.08, 0.08, 6, RUSTIC_FENCE_COLOR, cellSize)
    }
    pushRotBox(positions, indices, normals, colors, pl.x, pl.y, hz + 0.5, fL, 0.08, 0.08, fYaw, RUSTIC_FENCE_COLOR, cellSize)
    pushRotBox(positions, indices, normals, colors, pl.x, pl.y, hz + 0.9, fL, 0.08, 0.08, fYaw, RUSTIC_FENCE_COLOR, cellSize)
  }

  // 11. ROADSIDE STONE WATER TROUGHS (Brunnentrog fed by mountain spring)
  const troughJunctions: Vec2[] = []
  if (plazaCenter) {
    troughJunctions.push({ x: plazaCenter.x - 9.2, y: plazaCenter.y + 2.0 })
    troughJunctions.push({ x: plazaCenter.x + 9.2, y: plazaCenter.y - 2.0 })
  }
  for (const tr of troughJunctions) {
    const tz = surfaceZ(opts.heightGrid, tr.x, tr.y, cellSize)
    pushRotBox(positions, indices, normals, colors, tr.x, tr.y, tz + 0.4, 2.2, 1.1, 0.8, 0.3, PLAZA_MONUMENT_COLOR, cellSize)
    pushRotBox(positions, indices, normals, colors, tr.x, tr.y, tz + 0.72, 1.8, 0.8, 0.05, 0.3, FOUNTAIN_WATER_COLOR, cellSize)
    pushCylinder(positions, indices, normals, colors, tr.x - 0.8, tr.y, tz + 0.8, tz + 1.4, 0.08, 0.08, 6, WOOD_PLANK_COLOR, cellSize)
  }

  // 12. WOODCUTTER LOGGING CAMP & FIREWOOD STACKS AT FOREST BORDER
  let woodCampX = 86, woodCampY = 38
  const zWood = surfaceZ(opts.heightGrid, woodCampX, woodCampY, cellSize)
  const logL = 3.6, logR = 0.25
  for (let row = 0; row < 3; row++) {
    const count = 3 - row
    for (let c = 0; c < count; c++) {
      const lx = woodCampX + (c - count * 0.5 + 0.5) * (logR * 2.1)
      const lz = zWood + row * (logR * 1.8) + logR
      pushCylinder(positions, indices, normals, colors, lx, woodCampY, lz - logL * 0.5, lz + logL * 0.5, logR, logR, 6, WOOD_BARREL_COLOR, cellSize)
    }
  }
  pushCylinder(positions, indices, normals, colors, woodCampX + 2.2, woodCampY + 1.2, zWood, zWood + 0.65, 0.35, 0.35, 6, WOOD_BARREL_COLOR, cellSize)

  // 13. WROUGHT-IRON STREET LANTERNS ALONG MAIN ROADS & PLAZA
  const lampPositions: Vec2[] = []
  if (bridgeStart) lampPositions.push(bridgeStart)
  if (bridgeEnd) lampPositions.push(bridgeEnd)
  if (roadPts.length >= 2) {
    const dRoad = densifyCorridor(roadPts, false, 14)
    walkArc(dRoad, 16, (lx, ly) => {
      if (distToSpline(lx, ly, [bridgeStart ?? { x: 0, y: 0 }, bridgeEnd ?? { x: 0, y: 0 }]) > 4.0) {
        lampPositions.push({ x: lx + 2.4, y: ly + 2.4 })
      }
    })
  }
  for (const lp of lampPositions) {
    if (isNearAvoid(lp.x, lp.y, 2.0)) continue
    const lz = surfaceZ(opts.heightGrid, lp.x, lp.y, cellSize)
    const lH = 3.2
    pushRotBox(positions, indices, normals, colors, lp.x, lp.y, lz + 0.25, 0.45, 0.45, 0.5, 0, PLAZA_MONUMENT_COLOR, cellSize)
    pushCylinder(positions, indices, normals, colors, lp.x, lp.y, lz + 0.5, lz + lH, 0.08, 0.06, 6, IRON_LANTERN_COLOR, cellSize)
    pushRotBox(positions, indices, normals, colors, lp.x + 0.25, lp.y, lz + lH, 0.5, 0.06, 0.06, 0, IRON_LANTERN_COLOR, cellSize)
    pushRotBox(positions, indices, normals, colors, lp.x + 0.45, lp.y, lz + lH - 0.25, 0.26, 0.26, 0.35, 0, IRON_LANTERN_COLOR, cellSize)
    pushRotBox(positions, indices, normals, colors, lp.x + 0.45, lp.y, lz + lH - 0.25, 0.18, 0.18, 0.22, 0, LANTERN_GLOW_COLOR, cellSize)
  }

  // 14. DIRECTIONAL FINGERPOST SIGNPOSTS AT JUNCTIONS
  const signJunctions: Vec2[] = []
  if (plazaCenter) {
    signJunctions.push({ x: plazaCenter.x + 8.5, y: plazaCenter.y })
    signJunctions.push({ x: plazaCenter.x - 8.5, y: plazaCenter.y })
    signJunctions.push({ x: plazaCenter.x, y: plazaCenter.y + 8.5 })
  }
  if (mill) signJunctions.push({ x: mill.x + 3.6, y: mill.y + 2.2 })
  if (trailPts.length > 0) signJunctions.push(trailPts[0]!)
  for (const j of signJunctions) {
    const jz = surfaceZ(opts.heightGrid, j.x, j.y, cellSize)
    const postH = 2.2
    pushCylinder(positions, indices, normals, colors, j.x, j.y, jz, jz + postH, 0.1, 0.08, 6, WOOD_PLANK_COLOR, cellSize)
    pushRotBox(positions, indices, normals, colors, j.x + 0.45, j.y, jz + postH - 0.25, 0.9, 0.08, 0.22, 0.2, WOOD_PLANK_COLOR, cellSize)
    pushRotBox(positions, indices, normals, colors, j.x - 0.4, j.y + 0.2, jz + postH - 0.5, 0.8, 0.08, 0.22, -0.6, WOOD_PLANK_COLOR, cellSize)
  }

  if (indices.length === 0) return null

  return {
    positions,
    indices,
    normals,
    colors,
    color: [...WOOD_PLANK_COLOR],
    role: 'houses',
  }
}
