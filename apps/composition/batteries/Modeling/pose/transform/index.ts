/**
 * transform — move a hangable mesh so its local origin sits at (x, y, z).
 * Yaw is radians around world +Z (keep upright). Scale is uniform about the origin.
 */

import { unwrapSpatialWireValue } from '../../../../vendor/shared/types/scene/spatial.js'
import { peelHangableMesh, poseMesh } from '../../../../vendor/shared/types/scene/mesh3d.js'

function metres(value: unknown, fallback: number): number {
  const n = Number(unwrapSpatialWireValue(value) ?? fallback)
  return Number.isFinite(n) ? n : fallback
}

export function transform(input: Record<string, unknown> = {}): Record<string, unknown> {
  const mesh = peelHangableMesh(input.geometry)
  if (!mesh) return { error: 'transform requires hangable Geometry kind mesh' }
  return {
    geometry: poseMesh(mesh, {
      x: metres(input.x, 0),
      y: metres(input.y, 0),
      z: metres(input.z, 0),
      yaw: metres(input.yaw, 0),
      scale: metres(input.scale, 1),
    }),
  }
}
