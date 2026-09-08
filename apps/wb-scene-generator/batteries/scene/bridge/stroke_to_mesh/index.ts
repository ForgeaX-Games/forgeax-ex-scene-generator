/**
 * stroke_to_mesh — turn a road/stroke mask into a light ground-hugging strip.
 *
 * Cell occupancy comes from `grid` (polyline_road_spline.outputGrid). Optional
 * `heightGrid` lifts the strip onto the hillside so it does not sit at z=0.
 */

import { buildStrokeMesh } from '../../../../vendor/dist/shared/types/index.js'

interface StrokeToMeshResult {
  mesh?: ReturnType<typeof buildStrokeMesh>
  triangleCount: number
  error?: string
}

export function strokeToMesh(input: Record<string, unknown>): StrokeToMeshResult {
  const grid = input.grid ?? input.mask ?? input.outputGrid
  if (!Array.isArray(grid) || grid.length === 0) {
    return { triangleCount: 0, error: 'grid is required and non-empty' }
  }
  const heightGrid = Array.isArray(input.heightGrid) ? input.heightGrid : undefined
  const cellSizeRaw = input.cellSize
  const cellSize = typeof cellSizeRaw === 'number' ? cellSizeRaw : Number(cellSizeRaw)
  const liftRaw = input.lift
  const lift = typeof liftRaw === 'number' ? liftRaw : Number(liftRaw)
  const mesh = buildStrokeMesh(grid, {
    ...(heightGrid ? { heightGrid } : {}),
    ...(Number.isFinite(cellSize) && cellSize > 0 ? { cellSize } : {}),
    ...(Number.isFinite(lift) ? { lift } : {}),
  })
  if (!mesh) return { triangleCount: 0, error: 'stroke produced no triangles' }
  return { mesh, triangleCount: mesh.indices.length / 3 }
}
