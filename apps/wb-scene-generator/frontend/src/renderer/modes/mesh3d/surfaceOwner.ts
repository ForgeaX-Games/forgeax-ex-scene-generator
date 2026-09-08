// 💡 3DMesh surface ownership — pure, mode-local (no imports from other modes).
//
// For each (x, y), the visible surface winner among tile voxels follows the same
// coverage semantics as the billboard painter's (z, layerIdx) ASC keys: later
// draw wins → higher z, then higher layerIdx.

export interface TileCellSample {
  x: number
  y: number
  z: number
  layerIdx: number
  /** Layer projection value — drives colorForValue. */
  value: number
  /** Scene asset_name — exact-match key into plugin PBR materials. */
  assetName: string
  layerKey: string
  nodeId: string
}

export interface SurfaceOwner {
  x: number
  y: number
  z: number
  layerIdx: number
  value: number
  assetName: string
  layerKey: string
  nodeId: string
}

export interface SurfaceField {
  /** Sparse map key `${x},${y}` → owner. */
  owners: Map<string, SurfaceOwner>
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export function cellKey(x: number, y: number): string {
  return `${x},${y}`
}

/** True when this layer should contribute to the 3DMesh terrain. */
export function isTileTerrainLayer(assetType: string | undefined): boolean {
  return assetType === 'tile'
}

/**
 * Compare two samples for surface coverage at the same (x, y).
 * Positive ⇒ `a` draws after `b` (a wins). Matches painter (z, layerIdx) ASC.
 */
export function compareSurfaceCoverage(a: Pick<TileCellSample, 'z' | 'layerIdx'>, b: Pick<TileCellSample, 'z' | 'layerIdx'>): number {
  if (a.z !== b.z) return a.z - b.z
  return a.layerIdx - b.layerIdx
}

/** Fold tile cell samples into a sparse surface field (one owner per XY). */
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
        value: s.value,
        assetName: s.assetName,
        layerKey: s.layerKey,
        nodeId: s.nodeId,
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

/**
 * Single-material MVP: among all per-cell surface winners, pick the globally
 * highest (z, layerIdx) owner — its assetName drives the whole-mesh PBR pack.
 */
export function pickDominantOwner(field: SurfaceField): SurfaceOwner | null {
  let best: SurfaceOwner | null = null
  for (const o of field.owners.values()) {
    if (!best || compareSurfaceCoverage(o, best) > 0) best = o
  }
  return best
}
