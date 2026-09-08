/**
 * landmark_watchtower: Village central watchtower / bell tower.
 */

import { buildLandmarkWatchtowerMesh, parsePoint2d, type SceneMesh } from '../../../../vendor/shared/types/index.js'

export interface LandmarkWatchtowerResult {
  mesh?: SceneMesh
  triangleCount: number
  error?: string
}

export function landmarkWatchtower(input: Record<string, unknown>): LandmarkWatchtowerResult {
  const pos = parsePoint2d(input.position ?? input.pos)
  if (!pos) {
    return { triangleCount: 0, error: 'position point2d is required' }
  }

  const mesh = buildLandmarkWatchtowerMesh({
    position: pos,
    heightGrid: input.heightGrid,
    baseSize: typeof input.baseSize === 'number' ? input.baseSize : undefined,
    height: typeof input.height === 'number' ? input.height : undefined,
    yaw: typeof input.yaw === 'number' ? input.yaw : undefined,
    cellSize: typeof input.cellSize === 'number' ? input.cellSize : undefined,
  })

  if (!mesh) return { triangleCount: 0, error: 'failed to generate landmark watchtower mesh' }
  return { mesh, triangleCount: mesh.indices.length / 3 }
}
