/**
 * stroke_sweep_mesh: sampled centerline → swept road strip.
 * Visible road is a ribbon, not a rasterized mask triangulation.
 */

import { buildSweepMesh, parsePoint2dList, parseNumberList, type SceneMesh } from '../../../../vendor/shared/types/index.js'

export interface StrokeSweepMeshResult {
  mesh?: SceneMesh
  triangleCount: number
  error?: string
}

export function strokeSweepMesh(input: Record<string, unknown>): StrokeSweepMeshResult {
  const pts = parsePoint2dList(input.points ?? input.centerline).map(([x, y]) => [x, y] as [number, number])
  if (pts.length < 2) {
    return { triangleCount: 0, error: 'points must contain at least 2 centerline samples' }
  }
  const roadWidth = typeof input.roadWidth === 'number' && input.roadWidth > 0 ? input.roadWidth : 3
  const lift = typeof input.lift === 'number' && Number.isFinite(input.lift) ? input.lift : undefined
  const cellSize = typeof input.cellSize === 'number' && input.cellSize > 0 ? input.cellSize : undefined
  const colorList = parseNumberList(input.color)
  const color = colorList.length >= 3
    ? [colorList[0]!, colorList[1]!, colorList[2]!] as const
    : undefined
  const mesh = buildSweepMesh(pts, {
    heightGrid: input.heightGrid,
    widths: parseNumberList(input.widths),
    roadWidth,
    ...(lift != null ? { lift } : {}),
    ...(cellSize != null ? { cellSize } : {}),
    ...(color ? { color } : {}),
  })
  if (!mesh) return { triangleCount: 0, error: 'sweep produced no triangles' }
  return { mesh, triangleCount: mesh.indices.length / 3 }
}
