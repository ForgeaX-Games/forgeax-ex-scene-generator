import { buildPolyline } from '../../../../../../packages/scene-authoring/src/types/operating.js'

export function polyline2d(input: Record<string, unknown>): Record<string, unknown> {
  return buildPolyline(input)
}
