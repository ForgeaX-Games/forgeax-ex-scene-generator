/**
 * heightfieldExplode — unpack a Heightfield packet into its parts.
 */

import {
  explodeHeightfield,
  unwrapHeightfield,
} from '../../../../vendor/shared/types/scene/heightfieldField.js'

export function heightfieldExplode(input: Record<string, unknown>): {
  geometry?: ReturnType<typeof explodeHeightfield>['geometry']
  columns?: number
  rows?: number
  height?: number[][]
  mask?: number[][]
  attributes?: Record<string, number[][]>
  error?: string
} {
  const field = unwrapHeightfield(input.heightfield)
  if (!field) return { error: 'heightfieldExplode requires a Heightfield packet' }
  return explodeHeightfield(field)
}
