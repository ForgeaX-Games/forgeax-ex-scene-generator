// 💡 Collect object-layer placements for GLB instancing (mode-local).

import { BASE_CELL_SIZE } from '../../framework/geometry/constants'
import { gridCellCenterToWorld } from '../../framework/geometry/worldCoordinates'
import { pickModelVariant } from './modelVariants'
import { cellKey, type SurfaceField } from './surfaceOwner'

export interface ObjectCellSample {
  x: number
  y: number
  z: number
  assetName: string
  instanceId: string | null
  layerKey: string
}

export interface ObjectPlacement {
  /** Requested assetName (may be a family stem like `firtree`). */
  requestedName: string
  /** Resolved pack name after variant pick (e.g. `firtree3`). */
  name: string
  /** Grid anchor (footprint front-center-ish). */
  x: number
  y: number
  /** Terrain top Z if available, else object cell top. */
  groundZ: number
  instanceKey: string
}

export function isObjectPropLayer(assetType: string | undefined): boolean {
  return assetType === 'object' || assetType === 'asset'
}

/**
 * Collapse object cells into one placement per instance (or per lone cell).
 * Anchor = mean XY of the instance footprint; ground from terrain surface when present.
 * `catalog` (installed model names) enables family stems like `firtree` → `firtree1`…`6`.
 */
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
    let groundZ = (maxZ + 1) * BASE_CELL_SIZE
    if (terrain) {
      let best = -Infinity
      for (const c of g.cells) {
        const o = terrain.owners.get(cellKey(c.x, c.y))
        if (o) best = Math.max(best, (o.z + 1) * BASE_CELL_SIZE)
      }
      const atAnchor = terrain.owners.get(cellKey(x, y))
      if (atAnchor) best = Math.max(best, (atAnchor.z + 1) * BASE_CELL_SIZE)
      if (best > -Infinity) groundZ = best
    }
    const resolved = pickModelVariant(g.name, instanceKey, catalog)
    out.push({
      requestedName: g.name,
      name: resolved,
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
  _minX: number,
  _maxX: number,
  _minY: number,
  _maxY: number,
  cellSize = BASE_CELL_SIZE,
): { wx: number; wy: number } {
  const world = gridCellCenterToWorld(cellX, cellY)
  return {
    wx: world.x * cellSize,
    wy: world.y * cellSize,
  }
}
