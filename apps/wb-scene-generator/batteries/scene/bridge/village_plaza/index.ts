/**
 * village_plaza: Paved village marketplace plaza slab.
 */

import { buildVillagePlazaMesh, parsePoint2d, type SceneMesh } from '../../../../vendor/shared/types/index.js'

export interface VillagePlazaResult {
  mesh?: SceneMesh
  triangleCount: number
  error?: string
}

export function villagePlaza(input: Record<string, unknown>): VillagePlazaResult {
  const center = parsePoint2d(input.center ?? input.position)
  if (!center) {
    return { triangleCount: 0, error: 'center point2d is required' }
  }

  const mesh = buildVillagePlazaMesh({
    center,
    heightGrid: input.heightGrid,
    radius: typeof input.radius === 'number' ? input.radius : undefined,
    cellSize: typeof input.cellSize === 'number' ? input.cellSize : undefined,
  })

  if (!mesh) return { triangleCount: 0, error: 'failed to generate village plaza mesh' }
  return { mesh, triangleCount: mesh.indices.length / 3 }
}
