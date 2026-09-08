/**
 * watermill_building: Riverfront watermill with 12-spoke waterwheel.
 */

import { buildWatermillMesh, parsePoint2d, type SceneMesh } from '../../../../vendor/shared/types/index.js'

export interface WatermillBuildingResult {
  mesh?: SceneMesh
  triangleCount: number
  error?: string
}

export function watermillBuilding(input: Record<string, unknown>): WatermillBuildingResult {
  const pos = parsePoint2d(input.position ?? input.pos)
  if (!pos) {
    return { triangleCount: 0, error: 'position point2d is required' }
  }

  const mesh = buildWatermillMesh({
    position: pos,
    heightGrid: input.heightGrid,
    yaw: typeof input.yaw === 'number' ? input.yaw : undefined,
    cellSize: typeof input.cellSize === 'number' ? input.cellSize : undefined,
  })

  if (!mesh) return { triangleCount: 0, error: 'failed to generate watermill mesh' }
  return { mesh, triangleCount: mesh.indices.length / 3 }
}
