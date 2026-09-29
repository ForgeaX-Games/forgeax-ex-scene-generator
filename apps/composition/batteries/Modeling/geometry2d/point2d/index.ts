import { buildPoint2d } from '../../../../../../packages/scene-authoring/src/types/operating.js'
import { unwrapSpatialWireValue } from '../../../../vendor/shared/types/scene/spatial.js'

export function point2d(input: Record<string, unknown>): Record<string, unknown> {
  return buildPoint2d({
    x: unwrapSpatialWireValue(input.x) ?? 0,
    y: unwrapSpatialWireValue(input.y) ?? 0,
  })
}
