/**
 * stone_arch_bridge: Spanning stone arch bridge across a river.
 */

import { buildStoneArchBridgeMesh, parsePoint2d, type SceneMesh } from '../../../../vendor/shared/types/index.js'

export interface StoneArchBridgeResult {
  mesh?: SceneMesh
  triangleCount: number
  error?: string
}

export function stoneArchBridge(input: Record<string, unknown>): StoneArchBridgeResult {
  const start = parsePoint2d(input.start)
  const end = parsePoint2d(input.end)
  if (!start || !end) {
    return { triangleCount: 0, error: 'start and end point2d are required' }
  }

  const mesh = buildStoneArchBridgeMesh({
    start,
    end,
    heightGrid: input.heightGrid,
    width: typeof input.width === 'number' ? input.width : undefined,
    archHeight: typeof input.archHeight === 'number' ? input.archHeight : undefined,
    parapetHeight: typeof input.parapetHeight === 'number' ? input.parapetHeight : undefined,
    cellSize: typeof input.cellSize === 'number' ? input.cellSize : undefined,
  })

  if (!mesh) return { triangleCount: 0, error: 'failed to generate stone arch bridge mesh' }
  return { mesh, triangleCount: mesh.indices.length / 3 }
}
