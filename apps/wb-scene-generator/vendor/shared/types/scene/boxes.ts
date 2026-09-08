/**
 * Axis-aligned white boxes and gabled houses sitting on a heightfield.
 * Used by grid_to_boxes and gabled_houses.
 *
 * When a heightGrid is wired, each footprint corner samples the terrain
 * surface (Choice A). Walls extrude up from those corners; no contact lift.
 */

import type { SceneMesh } from './content.js'
import { sampleHeightfieldSurface, unwrapHeightGrid } from './heightfield.js'
import { parsePoint2dList } from './points.js'

export const HOUSE_MESH_COLOR: readonly [number, number, number] = [0.96, 0.96, 0.94]

function surfaceZAtMesh(heightGrid: unknown, meshX: number, meshY: number, cellSize: number): number {
  return sampleHeightfieldSurface(heightGrid, meshX / cellSize, -meshY / cellSize) * cellSize
}

export interface BoxesMeshOpts {
  readonly heightGrid?: unknown
  readonly heights?: readonly number[]
  readonly buildingHeight?: number
  readonly footprint?: number
  readonly cellSize?: number
}

export interface GabledHousesMeshOpts {
  readonly heightGrid?: unknown
  readonly heights?: readonly number[]
  readonly buildingHeight?: number
  readonly roofHeight?: number
  readonly footprint?: number
  readonly depth?: number
  readonly cellSize?: number
  readonly foundation?: number
  readonly yaw?: readonly number[]
}

function pushBox(
  positions: number[],
  indices: number[],
  normals: number[],
  cx: number,
  cy: number,
  z00: number,
  z10: number,
  z11: number,
  z01: number,
  height: number,
  half: number,
): void {
  const x0 = cx - half
  const x1 = cx + half
  const y0 = -cy - half
  const y1 = -cy + half
  const t00 = z00 + height
  const t10 = z10 + height
  const t11 = z11 + height
  const t01 = z01 + height
  const faces: Array<{ verts: Array<[number, number, number]>; n: [number, number, number] }> = [
    { verts: [[x0, y0, z00], [x1, y0, z10], [x1, y1, z11], [x0, y1, z01]], n: [0, 0, -1] },
    { verts: [[x0, y0, t00], [x0, y1, t01], [x1, y1, t11], [x1, y0, t10]], n: [0, 0, 1] },
    { verts: [[x0, y0, z00], [x0, y0, t00], [x1, y0, t10], [x1, y0, z10]], n: [0, -1, 0] },
    { verts: [[x0, y1, z01], [x1, y1, z11], [x1, y1, t11], [x0, y1, t01]], n: [0, 1, 0] },
    { verts: [[x0, y0, z00], [x0, y1, z01], [x0, y1, t01], [x0, y0, t00]], n: [-1, 0, 0] },
    { verts: [[x1, y0, z10], [x1, y0, t10], [x1, y1, t11], [x1, y1, z11]], n: [1, 0, 0] },
  ]
  for (const face of faces) {
    const base = positions.length / 3
    for (const [x, y, z] of face.verts) {
      positions.push(x, y, z)
      normals.push(face.n[0], face.n[1], face.n[2])
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
}

function pushGabledHouse(
  positions: number[],
  indices: number[],
  normals: number[],
  cx: number,
  cy: number,
  zAt: (meshX: number, meshY: number) => number,
  w: number,
  d: number,
  wallHeight: number,
  roofHeight: number,
  foundation: number,
  yaw = 0,
): void {
  const halfW = w / 2
  const halfD = d / 2
  // yaw is world-XY heading (atan2(ty, tx)). Mesh Y = -world Y, so rotate by -yaw.
  const cos = Math.cos(-yaw)
  const sin = Math.sin(-yaw)
  const meshCy = -cy
  const rot = (lx: number, ly: number): [number, number] => [
    cx + lx * cos - ly * sin,
    meshCy + lx * sin + ly * cos,
  ]
  const rotN = (nx: number, ny: number): [number, number, number] => [
    nx * cos - ny * sin,
    nx * sin + ny * cos,
    0,
  ]
  const [x0, y0] = rot(-halfW, -halfD)
  const [x1, y0b] = rot(halfW, -halfD)
  const [x1b, y1] = rot(halfW, halfD)
  const [x0b, y1b] = rot(-halfW, halfD)
  const [rx0, ryRidge] = rot(-halfW, 0)
  const [rx1, ryRidge2] = rot(halfW, 0)

  const sitFL = zAt(x0, y0)
  const sitFR = zAt(x1, y0b)
  const sitBR = zAt(x1b, y1)
  const sitBL = zAt(x0b, y1b)
  const zFL = sitFL - foundation
  const zFR = sitFR - foundation
  const zBR = sitBR - foundation
  const zBL = sitBL - foundation
  const zFLw = sitFL + wallHeight
  const zFRw = sitFR + wallHeight
  const zBRw = sitBR + wallHeight
  const zBLw = sitBL + wallHeight
  const zRidgeL = (zFLw + zBLw) / 2 + roofHeight
  const zRidgeR = (zFRw + zBRw) / 2 + roofHeight

  const roofHyp = Math.hypot(halfD, roofHeight)
  const nyFront = roofHyp > 0 ? -roofHeight / roofHyp : 0
  const nzFront = roofHyp > 0 ? halfD / roofHyp : 1
  const nyBack = roofHyp > 0 ? roofHeight / roofHyp : 0
  const nzBack = roofHyp > 0 ? halfD / roofHyp : 1
  const nFront = rotN(0, -1)
  const nBack = rotN(0, 1)
  const nLeft = rotN(-1, 0)
  const nRight = rotN(1, 0)
  const nRoofF: [number, number, number] = (() => {
    const [nx, ny] = rotN(0, nyFront)
    return [nx, ny, nzFront]
  })()
  const nRoofB: [number, number, number] = (() => {
    const [nx, ny] = rotN(0, nyBack)
    return [nx, ny, nzBack]
  })()

  const quads: Array<{ verts: Array<[number, number, number]>; n: [number, number, number] }> = [
    { verts: [[x0, y0, zFL], [x0b, y1b, zBL], [x1b, y1, zBR], [x1, y0b, zFR]], n: [0, 0, -1] },
    { verts: [[x0, y0, zFL], [x1, y0b, zFR], [x1, y0b, zFRw], [x0, y0, zFLw]], n: nFront },
    { verts: [[x1b, y1, zBR], [x0b, y1b, zBL], [x0b, y1b, zBLw], [x1b, y1, zBRw]], n: nBack },
    { verts: [[x0b, y1b, zBL], [x0, y0, zFL], [x0, y0, zFLw], [x0b, y1b, zBLw]], n: nLeft },
    { verts: [[x1, y0b, zFR], [x1b, y1, zBR], [x1b, y1, zBRw], [x1, y0b, zFRw]], n: nRight },
    { verts: [[x0, y0, zFLw], [x1, y0b, zFRw], [rx1, ryRidge2, zRidgeR], [rx0, ryRidge, zRidgeL]], n: nRoofF },
    { verts: [[x1b, y1, zBRw], [x0b, y1b, zBLw], [rx0, ryRidge, zRidgeL], [rx1, ryRidge2, zRidgeR]], n: nRoofB },
  ]

  for (const q of quads) {
    const base = positions.length / 3
    for (const [x, y, z] of q.verts) {
      positions.push(x, y, z)
      normals.push(q.n[0], q.n[1], q.n[2])
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  const tris: Array<{ verts: Array<[number, number, number]>; n: [number, number, number] }> = [
    { verts: [[x0b, y1b, zBLw], [x0, y0, zFLw], [rx0, ryRidge, zRidgeL]], n: nLeft },
    { verts: [[x1, y0b, zFRw], [x1b, y1, zBRw], [rx1, ryRidge2, zRidgeR]], n: nRight },
  ]

  for (const t of tris) {
    const base = positions.length / 3
    for (const [x, y, z] of t.verts) {
      positions.push(x, y, z)
      normals.push(t.n[0], t.n[1], t.n[2])
    }
    indices.push(base, base + 1, base + 2)
  }
}

export function buildBoxesMesh(points: unknown, opts: BoxesMeshOpts = {}): SceneMesh | null {
  const pts = parsePoint2dList(points)
  if (pts.length === 0) return null
  const cellSize = typeof opts.cellSize === 'number' && opts.cellSize > 0 ? opts.cellSize : 1
  const buildingHeight = typeof opts.buildingHeight === 'number' && opts.buildingHeight > 0 ? opts.buildingHeight : 3
  const footprint = typeof opts.footprint === 'number' && opts.footprint > 0 ? opts.footprint : 2
  const half = (footprint * cellSize) / 2
  const height = buildingHeight * cellSize
  const onSurface = Boolean(unwrapHeightGrid(opts.heightGrid))
  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []
  pts.forEach(([x, y], i) => {
    const cx = x * cellSize
    const cy = y * cellSize
    const uniform = (opts.heights?.[i] ?? 0) * cellSize
    const zAt = (mx: number, my: number): number => (
      onSurface ? surfaceZAtMesh(opts.heightGrid, mx, my, cellSize) : uniform
    )
    const x0 = cx - half
    const x1 = cx + half
    const y0 = -cy - half
    const y1 = -cy + half
    pushBox(
      positions,
      indices,
      normals,
      cx,
      cy,
      zAt(x0, y0),
      zAt(x1, y0),
      zAt(x1, y1),
      zAt(x0, y1),
      height,
      half,
    )
  })
  if (indices.length === 0) return null
  return { positions, indices, normals, color: [...HOUSE_MESH_COLOR], role: 'houses' }
}

export function buildGabledHousesMesh(points: unknown, opts: GabledHousesMeshOpts = {}): SceneMesh | null {
  const pts = parsePoint2dList(points)
  if (pts.length === 0) return null
  const cellSize = typeof opts.cellSize === 'number' && opts.cellSize > 0 ? opts.cellSize : 1
  const buildingHeight = typeof opts.buildingHeight === 'number' && opts.buildingHeight > 0 ? opts.buildingHeight : 3.2
  const roofHeight = typeof opts.roofHeight === 'number' && opts.roofHeight > 0 ? opts.roofHeight : 1.8
  const footprint = typeof opts.footprint === 'number' && opts.footprint > 0 ? opts.footprint : 3.0
  const depth = typeof opts.depth === 'number' && opts.depth > 0 ? opts.depth : 2.5
  const fallbackFoundation = typeof opts.foundation === 'number' && opts.foundation >= 0 ? opts.foundation : 0.6
  const onSurface = Boolean(unwrapHeightGrid(opts.heightGrid))
  const foundation = onSurface ? 0 : fallbackFoundation

  const positions: number[] = []
  const indices: number[] = []
  const normals: number[] = []

  pts.forEach(([x, y], i) => {
    const yaw = opts.yaw?.[i] ?? 0
    const uniformSit = (opts.heights?.[i] ?? 0) * cellSize
    const zAt = (mx: number, my: number): number => (
      onSurface ? surfaceZAtMesh(opts.heightGrid, mx, my, cellSize) : uniformSit
    )
    pushGabledHouse(
      positions,
      indices,
      normals,
      x * cellSize,
      y * cellSize,
      zAt,
      footprint * cellSize,
      depth * cellSize,
      buildingHeight * cellSize,
      roofHeight * cellSize,
      foundation * cellSize,
      yaw,
    )
  })

  if (indices.length === 0) return null
  return { positions, indices, normals, color: [...HOUSE_MESH_COLOR], role: 'houses' }
}
