/**
 * heightfieldSetMask — replace packet.mask only. Same lattice or { error }.
 */

import {
  setHeightfieldMask,
} from '../../../../vendor/shared/types/scene/heightfieldField.js'

export function heightfieldSetMask(input: Record<string, unknown>): {
  heightfield?: ReturnType<typeof setHeightfieldMask>['field']
  _warnings: Array<Record<string, unknown>>
  error?: string
} {
  const set = setHeightfieldMask({
    heightfield: input.heightfield,
    mask: input.mask,
  })
  if (!set.field) {
    return { _warnings: [], error: set.error ?? 'heightfieldSetMask requires a Heightfield packet and a mask Grid' }
  }
  return {
    heightfield: set.field,
    _warnings: set.field.stretch ? [set.field.stretch] : [],
  }
}
