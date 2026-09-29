import { buildPolyline3d } from '../../../../../../packages/scene-authoring/src/types/operating.js'

export function polyline3d(input: Record<string, unknown>): Record<string, unknown> {
  return buildPolyline3d(input)
}
