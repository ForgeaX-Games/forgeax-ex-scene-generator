/**
 * Road-strip mesh: heightfield triangulation restricted to a stroke mask.
 * Shared by the stroke_to_mesh battery. Pure arrays — no THREE.
 */

import { buildHeightfieldMesh } from './heightfield.js'
import type { SceneMesh } from './content.js'

export const ROAD_MESH_COLOR: readonly [number, number, number] = [0.84, 0.80, 0.72]
/** Geometric lift is off by default; coplanar z-fight is a renderer offset, not a gap. */
export const ROAD_MESH_LIFT = 0

export interface StrokeMeshOpts {
  readonly heightGrid?: unknown
  readonly cellSize?: number
  readonly lift?: number
  readonly color?: readonly [number, number, number]
}

/** Mask cells become a light strip; Z follows heightGrid (or the mask itself). */
export function buildStrokeMesh(mask: unknown, opts: StrokeMeshOpts = {}): SceneMesh | null {
  const height = opts.heightGrid ?? mask
  const color = opts.color ?? ROAD_MESH_COLOR
  const built = buildHeightfieldMesh(height, {
    mask: Array.isArray(mask) ? mask as number[][] : undefined,
    ...(typeof opts.cellSize === 'number' && opts.cellSize > 0 ? { cellSize: opts.cellSize } : {}),
    color,
  })
  if (!built) return null
  const lift = typeof opts.lift === 'number' && Number.isFinite(opts.lift) ? opts.lift : ROAD_MESH_LIFT
  if (lift === 0) return { ...built, role: 'road', color: [1, 1, 1] }
  const positions = built.positions.slice() as number[]
  for (let i = 2; i < positions.length; i += 3) positions[i] = (positions[i] ?? 0) + lift
  return { ...built, positions, role: 'road', color: [1, 1, 1] }
}
