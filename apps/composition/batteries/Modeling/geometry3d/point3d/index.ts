import { buildPoint3d } from '../../../../../../packages/scene-authoring/src/types/operating.js'
import { unwrapSpatialWireValue } from '../../../../vendor/shared/types/scene/spatial.js'

export function point3d(input: Record<string, unknown>): Record<string, unknown> {
  return buildPoint3d({
    x: unwrapSpatialWireValue(input.x) ?? 0,
    y: unwrapSpatialWireValue(input.y) ?? 0,
    z: unwrapSpatialWireValue(input.z) ?? 0,
  })
}
