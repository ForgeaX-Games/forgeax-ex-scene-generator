/**
 * liftToSurface — vertical Φ(u,v)=(xy,h) from 2D operating Geometry onto a Heightfield.
 * Mode is vertical only. Shared network nodes keep their indices.
 */

import { liftOperatingGeometry } from '../../../../vendor/shared/types/scene/liftToSurface.js'

export function liftToSurface(input: Record<string, unknown>): Record<string, unknown> {
  return liftOperatingGeometry(input.geometry, input.surface ?? input.heightfield)
}
