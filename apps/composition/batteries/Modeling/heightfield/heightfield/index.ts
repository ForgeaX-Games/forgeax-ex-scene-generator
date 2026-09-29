/**
 * heightfield — bind a world plane to a co-registered height packet.
 * Lattice comes from the height Grid. Mask defaults to ones.
 */

import { bindHeightfield } from '../../../../vendor/shared/types/scene/heightfieldField.js'

export function heightfield(input: Record<string, unknown>): {
  heightfield?: ReturnType<typeof bindHeightfield>['field']
  _warnings: Array<Record<string, unknown>>
  error?: string
} {
  const bound = bindHeightfield({
    geometry: input.geometry ?? input.plane,
    height: input.height ?? input.grid ?? input.heightGrid,
    mask: input.mask,
    attributes: input.attributes,
  })
  if (!bound.field) {
    return { _warnings: [], error: bound.error ?? 'heightfield requires a Geometry plane and a height Grid' }
  }
  return {
    heightfield: bound.field,
    _warnings: bound.field.stretch ? [bound.field.stretch] : [],
  }
}
