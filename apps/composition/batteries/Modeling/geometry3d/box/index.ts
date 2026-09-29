/**
 * box — hangable Geometry kind mesh in local metres.
 * Origin is the floor-centre contact. World pose is transform / placeOnGround.
 */

import { unwrapSpatialWireValue } from '../../../../vendor/shared/types/scene/spatial.js'
import { buildBoxMesh } from '../../../../vendor/shared/types/scene/mesh3d.js'

function metres(value: unknown, fallback: number): number {
  const n = Number(unwrapSpatialWireValue(value) ?? fallback)
  return Number.isFinite(n) ? n : fallback
}

export function box(input: Record<string, unknown> = {}): Record<string, unknown> {
  const width = metres(input.width, 1)
  const depth = metres(input.depth, 1)
  const height = metres(input.height, 1)
  if (width <= 0 || depth <= 0 || height <= 0) {
    return { error: 'box requires positive width, depth, and height in metres' }
  }
  return { geometry: buildBoxMesh(width, depth, height) }
}
