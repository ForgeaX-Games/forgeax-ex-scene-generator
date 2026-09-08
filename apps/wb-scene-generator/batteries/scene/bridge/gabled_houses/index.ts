/**
 * gabled_houses (GabledHouses):
 * Procedural architectural white-model houses with gabled pitched roofs,
 * foundation plinths, and sloped roof planes.
 */

import { buildGabledHousesMesh, type SceneMesh } from '../../../../vendor/shared/types/index.js'

export interface GabledHousesResult {
  mesh?: SceneMesh
  count?: number
  error?: string
}

export function gabledHouses(input: Record<string, unknown>): GabledHousesResult {
  const points = input.points ?? input.plots
  if (!points) return { error: 'points is required' }
  const mesh = buildGabledHousesMesh(points, {
    heightGrid: input.heightGrid,
    heights: Array.isArray(input.z) ? input.z as number[] : undefined,
    buildingHeight: typeof input.buildingHeight === 'number' ? input.buildingHeight : undefined,
    roofHeight: typeof input.roofHeight === 'number' ? input.roofHeight : undefined,
    footprint: typeof input.footprint === 'number' ? input.footprint : undefined,
    depth: typeof input.depth === 'number' ? input.depth : undefined,
    cellSize: typeof input.cellSize === 'number' ? input.cellSize : undefined,
    yaw: Array.isArray(input.yaw) ? input.yaw as number[] : undefined,
  })
  if (!mesh) return { error: 'failed to generate gabled houses mesh (empty points or invalid geometry)' }
  const count = Array.isArray(points) ? points.length : 0
  return { mesh, count }
}
