/**
 * placeOnGround — sit a hangable mesh on the Heightfield at (x, y).
 * Reads the same height channel as sampleHeight / heightfieldMesh.
 */

import { sampleHeightfieldWorld, unwrapHeightfield } from '../../../../vendor/shared/types/scene/heightfieldField.js'
import { unwrapSpatialWireValue } from '../../../../vendor/shared/types/scene/spatial.js'
import { peelHangableMesh, sitMeshOnGround } from '../../../../vendor/shared/types/scene/mesh3d.js'

function metres(value: unknown, fallback?: number): number | null {
  const n = Number(unwrapSpatialWireValue(value) ?? fallback)
  return Number.isFinite(n) ? n : fallback ?? null
}

export function placeOnGround(input: Record<string, unknown> = {}): Record<string, unknown> {
  const mesh = peelHangableMesh(input.geometry)
  if (!mesh) return { error: 'placeOnGround requires hangable Geometry kind mesh' }
  const field = unwrapHeightfield(input.heightfield)
  const x = metres(input.x)
  const y = metres(input.y)
  if (!field || x == null || y == null) {
    return { error: 'placeOnGround requires heightfield, x, y in authoring metres' }
  }
  const z = sampleHeightfieldWorld(field, x, y)
  if (z == null) {
    return { error: `placeOnGround: (${x}, ${y}) is outside the Heightfield; pick a site on the terrain XY` }
  }
  return {
    geometry: sitMeshOnGround(mesh, {
      x,
      y,
      z,
      yaw: metres(input.yaw, 0) ?? 0,
      offset: metres(input.offset, 0) ?? 0,
    }),
  }
}
