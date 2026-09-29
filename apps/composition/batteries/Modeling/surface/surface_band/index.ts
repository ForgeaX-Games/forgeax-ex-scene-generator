/**
 * surfaceBand — Minkowski band of a 3D skeleton sat on a hangable mesh.
 * Width is metres on this consumer. Output is a constructed Geometry mesh.
 */

import { buildSurfaceBand } from '../../../../vendor/shared/types/scene/surfaceBand.js'

export function surfaceBand(input: Record<string, unknown>): Record<string, unknown> {
  return buildSurfaceBand(input)
}
