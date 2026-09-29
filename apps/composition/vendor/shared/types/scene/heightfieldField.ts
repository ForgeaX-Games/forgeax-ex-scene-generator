/**
 * Heightfield is a world-bound packet: region + lattice + height + mask + attrs.
 * Channel payloads are Grid. This is not a construction tree.
 */

import { asPlane, type Plane } from './spatial.js'
import { heightfieldStretchMetrics, unwrapHeightGrid, type HeightfieldStretchMetrics } from './heightfield.js'

export interface HeightfieldWarning {
  code: string
  message: string
  [key: string]: unknown
}

export interface Heightfield {
  type: 'heightfield'
  geometry: Plane & { kind?: 'plane' }
  columns: number
  rows: number
  height: number[][]
  mask: number[][]
  attributes: Record<string, number[][]>
  stretch?: HeightfieldWarning & HeightfieldStretchMetrics
}

export function isHeightfield(value: unknown): value is Heightfield {
  if (!value || typeof value !== 'object') return false
  const rec = value as Record<string, unknown>
  if (rec.type !== 'heightfield') return false
  return Array.isArray(rec.height) && rec.height.length > 0 && Array.isArray((rec.height as unknown[])[0])
}

export function unwrapHeightfield(value: unknown, depth = 0): Heightfield | null {
  if (value == null || depth > 8) return null
  if (isHeightfield(value)) return value
  if (Array.isArray(value) && value.length > 0) {
    const first = value[0] as { items?: unknown[] } | unknown
    if (first && typeof first === 'object' && Array.isArray((first as { items?: unknown[] }).items)) {
      const items = (first as { items: unknown[] }).items
      return unwrapHeightfield(items.length === 1 ? items[0] : items, depth + 1)
    }
    if (value.length === 1) return unwrapHeightfield(value[0], depth + 1)
  }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>
    if (Array.isArray(rec.items)) {
      return unwrapHeightfield(rec.items.length === 1 ? rec.items[0] : rec.items, depth + 1)
    }
    if (rec.heightfield !== undefined) return unwrapHeightfield(rec.heightfield, depth + 1)
  }
  return null
}

export function gridSize(grid: number[][]): { rows: number; columns: number } {
  const rows = grid.length
  const columns = grid.reduce((max, row) => (Array.isArray(row) && row.length > max ? row.length : max), 0)
  return { rows, columns }
}

function sameLattice(grid: number[][], rows: number, columns: number): boolean {
  const size = gridSize(grid)
  return size.rows === rows && size.columns === columns
}

function ones(rows: number, columns: number): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => 1))
}

function stretchWarning(plane: Plane, grid: number[][]): (HeightfieldWarning & HeightfieldStretchMetrics) | undefined {
  const { rows, columns } = gridSize(grid)
  const stretch = heightfieldStretchMetrics(plane.width, plane.height, columns, rows)
  if (!stretch.anisotropic) return undefined
  return {
    ...stretch,
    code: 'SCENE_GRID_STRETCH',
    message: [
      `Height grid ${stretch.columns}×${stretch.rows} covers plane ${stretch.planeWidth.toFixed(1)}×${stretch.planeHeight.toFixed(1)} m`,
      `cell ${stretch.cellSizeX.toFixed(3)}×${stretch.cellSizeY.toFixed(3)} m`,
      `plane aspect ${stretch.planeAspect.toFixed(3)} vs grid aspect ${stretch.gridAspect.toFixed(3)}`,
      `stretch ratio ${stretch.stretchRatio.toFixed(3)} (anisotropic)`,
    ].join('; '),
  }
}

function unwrapAttributes(value: unknown, depth = 0): Record<string, number[][]> {
  if (value == null || depth > 8) return {}
  if (Array.isArray(value)) {
    if (value.length === 0) return {}
    const first = value[0]
    if (first && typeof first === 'object' && Array.isArray((first as { items?: unknown[] }).items)) {
      const items = (first as { items: unknown[] }).items
      return unwrapAttributes(items.length === 1 ? items[0] : items, depth + 1)
    }
    if (value.length === 1) return unwrapAttributes(value[0], depth + 1)
    return {}
  }
  if (typeof value !== 'object') return {}
  const rec = value as Record<string, unknown>
  if (rec.attributes && typeof rec.attributes === 'object' && !Array.isArray(rec.attributes)) {
    return unwrapAttributes(rec.attributes, depth + 1)
  }
  const out: Record<string, number[][]> = {}
  for (const [key, raw] of Object.entries(rec)) {
    if (key === 'height' || key === 'mask' || key === 'geometry' || key === 'type') continue
    const grid = unwrapHeightGrid(raw)
    if (grid) out[key] = grid
  }
  return out
}

export function bindHeightfield(input: {
  geometry?: unknown
  height?: unknown
  grid?: unknown
  mask?: unknown
  attributes?: unknown
}): { field?: Heightfield; error?: string } {
  const plane = asPlane(input.geometry)
  const height = unwrapHeightGrid(input.height ?? input.grid)
  if (!plane || !height) return { error: 'heightfield requires a Geometry plane and a height Grid' }
  const { rows, columns } = gridSize(height)
  if (rows < 1 || columns < 1) return { error: 'height Grid is empty' }
  const mask = unwrapHeightGrid(input.mask) ?? ones(rows, columns)
  if (!sameLattice(mask, rows, columns)) {
    return { error: `mask is ${gridSize(mask).columns}×${gridSize(mask).rows}, expected ${columns}×${rows}` }
  }
  const attributes = unwrapAttributes(input.attributes)
  for (const [name, grid] of Object.entries(attributes)) {
    if (!sameLattice(grid, rows, columns)) {
      return { error: `attribute '${name}' is ${gridSize(grid).columns}×${gridSize(grid).rows}, expected ${columns}×${rows}` }
    }
  }
  const stretch = stretchWarning(plane, height)
  return {
    field: {
      type: 'heightfield',
      geometry: { kind: 'plane', ...plane },
      columns,
      rows,
      height,
      mask,
      attributes,
      ...(stretch ? { stretch } : {}),
    },
  }
}

export function setHeightfieldMask(input: {
  heightfield?: unknown
  mask?: unknown
}): { field?: Heightfield; error?: string } {
  const field = unwrapHeightfield(input.heightfield)
  if (!field) return { error: 'heightfieldSetMask requires a Heightfield packet' }
  const mask = unwrapHeightGrid(input.mask)
  if (!mask) return { error: 'heightfieldSetMask requires a mask Grid' }
  if (!sameLattice(mask, field.rows, field.columns)) {
    return { error: `mask is ${gridSize(mask).columns}×${gridSize(mask).rows}, expected ${field.columns}×${field.rows}` }
  }
  return {
    field: {
      type: 'heightfield',
      geometry: field.geometry,
      columns: field.columns,
      rows: field.rows,
      height: field.height,
      mask,
      attributes: field.attributes,
      ...(field.stretch ? { stretch: field.stretch } : {}),
    },
  }
}

export function explodeHeightfield(field: Heightfield): {
  geometry: Plane & { kind?: 'plane' }
  columns: number
  rows: number
  height: number[][]
  mask: number[][]
  attributes: Record<string, number[][]>
} {
  return {
    geometry: field.geometry,
    columns: field.columns,
    rows: field.rows,
    height: field.height,
    mask: field.mask,
    attributes: field.attributes,
  }
}

function planeAabb(plane: Plane): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = Number(plane.origin[0]) || 0
  const y0 = Number(plane.origin[1]) || 0
  return { x0, y0, x1: x0 + plane.width, y1: y0 + plane.height }
}

function pointInAabb(x: number, y: number, box: { x0: number; y0: number; x1: number; y1: number }): boolean {
  return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1
}

function bilinear(grid: number[][], gx: number, gy: number): number {
  const { rows, columns } = gridSize(grid)
  if (rows === 0 || columns === 0) return 0
  const x0 = Math.max(0, Math.min(columns - 1, Math.floor(gx)))
  const y0 = Math.max(0, Math.min(rows - 1, Math.floor(gy)))
  const x1 = Math.max(0, Math.min(columns - 1, x0 + 1))
  const y1 = Math.max(0, Math.min(rows - 1, y0 + 1))
  const tx = Math.min(1, Math.max(0, gx - x0))
  const ty = Math.min(1, Math.max(0, gy - y0))
  const v00 = Number(grid[y0]?.[x0]) || 0
  const v10 = Number(grid[y0]?.[x1]) || 0
  const v01 = Number(grid[y1]?.[x0]) || 0
  const v11 = Number(grid[y1]?.[x1]) || 0
  return v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty
}

/** World-metre sample of the height channel. Outside the region is undefined. */
export function sampleHeightfieldWorld(field: Heightfield, x: number, y: number): number | undefined {
  const plane = asPlane(field.geometry) ?? field.geometry
  const box = planeAabb(plane)
  if (!pointInAabb(x, y, box)) return undefined
  const { rows, columns } = gridSize(field.height)
  if (rows === 0 || columns === 0) return undefined
  const cellSizeX = plane.width / columns
  const cellSizeY = plane.height / rows
  const gx = (x - box.x0) / cellSizeX - 0.5
  const gy = (y - box.y0) / cellSizeY - 0.5
  return bilinear(field.height, gx, gy)
}

/** Planar UV in 0–1 over the Heightfield plane. Same parameterization as sampleHeight. */
export function sampleHeightfieldUv(field: Heightfield, x: number, y: number): [number, number] | undefined {
  const plane = asPlane(field.geometry) ?? field.geometry
  const box = planeAabb(plane)
  if (!pointInAabb(x, y, box)) return undefined
  const width = plane.width || 1
  const height = plane.height || 1
  return [(x - box.x0) / width, (y - box.y0) / height]
}

/** Z-up normal from the same bilinear height sample as sampleHeight. */
export function sampleHeightfieldNormal(field: Heightfield, x: number, y: number): [number, number, number] | undefined {
  const plane = asPlane(field.geometry) ?? field.geometry
  const { rows, columns } = gridSize(field.height)
  if (rows === 0 || columns === 0) return undefined
  const cellSizeX = plane.width / columns
  const cellSizeY = plane.height / rows
  const stepX = Math.max(cellSizeX * 0.5, 1e-4)
  const stepY = Math.max(cellSizeY * 0.5, 1e-4)
  const z = sampleHeightfieldWorld(field, x, y)
  if (z === undefined) return undefined
  const zx0 = sampleHeightfieldWorld(field, x - stepX, y) ?? z
  const zx1 = sampleHeightfieldWorld(field, x + stepX, y) ?? z
  const zy0 = sampleHeightfieldWorld(field, x, y - stepY) ?? z
  const zy1 = sampleHeightfieldWorld(field, x, y + stepY) ?? z
  const nx = -(zx1 - zx0) / (2 * stepX)
  const ny = -(zy1 - zy0) / (2 * stepY)
  const len = Math.hypot(nx, ny, 1) || 1
  return [nx / len, ny / len, 1 / len]
}

/** Triangle index on the woven lattice (two triangles per cell). */
export function sampleHeightfieldFace(field: Heightfield, x: number, y: number): number | undefined {
  const plane = asPlane(field.geometry) ?? field.geometry
  const box = planeAabb(plane)
  if (!pointInAabb(x, y, box)) return undefined
  const { rows, columns } = gridSize(field.height)
  if (rows === 0 || columns === 0) return undefined
  const cellSizeX = plane.width / columns
  const cellSizeY = plane.height / rows
  const ix = Math.min(columns - 1, Math.max(0, Math.floor((x - box.x0) / cellSizeX)))
  const iy = Math.min(rows - 1, Math.max(0, Math.floor((y - box.y0) / cellSizeY)))
  const tx = (x - box.x0) / cellSizeX - ix
  const ty = (y - box.y0) / cellSizeY - iy
  return (iy * columns + ix) * 2 + (tx >= ty ? 0 : 1)
}

export interface HeightfieldSurfaceHit {
  point: [number, number, number]
  normal: [number, number, number]
  uv: [number, number]
  face: number
}

export function sampleHeightfieldSurfaceHit(
  field: Heightfield,
  x: number,
  y: number,
): HeightfieldSurfaceHit | undefined {
  const z = sampleHeightfieldWorld(field, x, y)
  if (z === undefined) return undefined
  const uv = sampleHeightfieldUv(field, x, y)
  const normal = sampleHeightfieldNormal(field, x, y)
  const face = sampleHeightfieldFace(field, x, y)
  if (!uv || !normal || face === undefined) return undefined
  return { point: [x, y, z], normal, uv, face }
}

export function fieldFrame(field: Heightfield): Plane {
  return asPlane(field.geometry) ?? field.geometry
}
