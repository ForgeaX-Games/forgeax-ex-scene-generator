/**
 * Placement math for mesh3d export.
 * Object variant resolution is SSOT in frontend modelVariants.ts (vendored for Node).
 */

import {
  pickModelVariant,
} from '../../../vendor/dist/renderer-resolve/renderer/modes/mesh3d/modelVariants.js'
import { MESH3D_CELL_SIZE } from './types.js'

export { hashString, listNumberedVariants, packFamilyStem, pickModelVariant } from '../../../vendor/dist/renderer-resolve/renderer/modes/mesh3d/modelVariants.js'

export interface TileCellSample {
  x: number
  y: number
  z: number
  layerIdx: number
  assetName: string
  layerKey: string
}

export interface ObjectCellSample {
  x: number
  y: number
  z: number
  assetName: string
  instanceId: string | null
  layerKey: string
}

export interface SurfaceOwner {
  x: number
  y: number
  z: number
  layerIdx: number
  assetName: string
  layerKey: string
}

export interface SurfaceField {
  owners: Map<string, SurfaceOwner>
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface ObjectPlacement {
  requestedName: string
  name: string
  x: number
  y: number
  groundZ: number
  instanceKey: string
}

export function cellKey(x: number, y: number): string {
  return `${x},${y}`
}

export function isTileTerrainLayer(assetType: string | undefined): boolean {
  return assetType === 'tile'
}

export function isObjectPropLayer(assetType: string | undefined): boolean {
  return assetType === 'object' || assetType === 'asset'
}

function compareSurfaceCoverage(
  a: Pick<TileCellSample, 'z' | 'layerIdx'>,
  b: Pick<TileCellSample, 'z' | 'layerIdx'>,
): number {
  if (a.z !== b.z) return a.z - b.z
  return a.layerIdx - b.layerIdx
}

export function buildSurfaceField(samples: ReadonlyArray<TileCellSample>): SurfaceField {
  const owners = new Map<string, SurfaceOwner>()
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const s of samples) {
    const k = cellKey(s.x, s.y)
    const prev = owners.get(k)
    if (!prev || compareSurfaceCoverage(s, prev) > 0) {
      owners.set(k, {
        x: s.x,
        y: s.y,
        z: s.z,
        layerIdx: s.layerIdx,
        assetName: s.assetName,
        layerKey: s.layerKey,
      })
    }
    if (s.x < minX) minX = s.x
    if (s.x > maxX) maxX = s.x
    if (s.y < minY) minY = s.y
    if (s.y > maxY) maxY = s.y
  }

  if (!Number.isFinite(minX)) {
    return { owners, minX: 0, maxX: -1, minY: 0, maxY: -1 }
  }
  return { owners, minX, maxX, minY, maxY }
}

export function buildObjectPlacements(
  samples: ReadonlyArray<ObjectCellSample>,
  terrain: SurfaceField | null,
  catalog: readonly string[] = [],
): ObjectPlacement[] {
  if (samples.length === 0) return []

  type Acc = { name: string; cells: ObjectCellSample[]; layerKey: string }
  const groups = new Map<string, Acc>()

  for (const s of samples) {
    const name = s.assetName?.trim() ?? ''
    if (!name) continue
    const key = s.instanceId
      ? `${s.layerKey}|${s.instanceId}|${name}`
      : `${s.layerKey}|cell:${s.x},${s.y},${s.z}|${name}`
    let g = groups.get(key)
    if (!g) {
      g = { name, cells: [], layerKey: s.layerKey }
      groups.set(key, g)
    }
    g.cells.push(s)
  }

  const out: ObjectPlacement[] = []
  for (const [instanceKey, g] of groups) {
    let sx = 0
    let sy = 0
    let maxZ = -Infinity
    for (const c of g.cells) {
      sx += c.x
      sy += c.y
      if (c.z > maxZ) maxZ = c.z
    }
    const n = g.cells.length
    const x = Math.round(sx / n)
    const y = Math.round(sy / n)
    let groundZ = (maxZ + 1) * MESH3D_CELL_SIZE
    if (terrain) {
      let best = -Infinity
      for (const c of g.cells) {
        const o = terrain.owners.get(cellKey(c.x, c.y))
        if (o) best = Math.max(best, (o.z + 1) * MESH3D_CELL_SIZE)
      }
      const atAnchor = terrain.owners.get(cellKey(x, y))
      if (atAnchor) best = Math.max(best, (atAnchor.z + 1) * MESH3D_CELL_SIZE)
      if (best > -Infinity) groundZ = best
    }
    out.push({
      requestedName: g.name,
      name: pickModelVariant(g.name, instanceKey, catalog),
      x,
      y,
      groundZ,
      instanceKey,
    })
  }
  return out
}

export function worldXY(
  cellX: number,
  cellY: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  cellSize = MESH3D_CELL_SIZE,
): { wx: number; wy: number } {
  const cols = maxX - minX + 1
  const rows = maxY - minY + 1
  return {
    wx: (cellX - minX - cols / 2 + 0.5) * cellSize,
    wy: (rows / 2 - (cellY - minY) - 0.5) * cellSize,
  }
}
