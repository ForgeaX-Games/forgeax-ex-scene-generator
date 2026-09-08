/**
 * heightfield_mesh — turn a height grid into a continuous white-model mesh.
 *
 * Cell value is elevation (layer units). Zero / empty cells are omitted unless
 * a mask keeps them. Output is a graph-level `mesh` port — Default draws it as
 * Terrain; mesh_to_node hangs it on the scene tree.
 */

import { buildHeightfieldMesh } from '../../../../vendor/dist/shared/types/index.js';

interface HeightfieldMeshResult {
  mesh?: ReturnType<typeof buildHeightfieldMesh>
  triangleCount: number
  error?: string
}

export function heightfieldMesh(input: Record<string, unknown>): HeightfieldMeshResult {
  const grid = input.grid ?? input.heightGrid ?? input.outputGrid
  if (!Array.isArray(grid) || grid.length === 0) {
    return { triangleCount: 0, error: 'grid is required and non-empty' }
  }
  const mask = Array.isArray(input.mask) ? input.mask : undefined
  const cellSizeRaw = input.cellSize
  const cellSize = typeof cellSizeRaw === 'number' ? cellSizeRaw : Number(cellSizeRaw)
  const mesh = buildHeightfieldMesh(grid, {
    ...(mask ? { mask: mask as number[][] } : {}),
    ...(Number.isFinite(cellSize) && cellSize > 0 ? { cellSize } : {}),
  })
  if (!mesh) return { triangleCount: 0, error: 'heightfield produced no triangles' }
  return { mesh, triangleCount: mesh.indices.length / 3 }
}
