import { buildPolygon } from '../../../../../../packages/scene-authoring/src/types/operating.js'

export function polygon2d(input: Record<string, unknown>): Record<string, unknown> {
  return buildPolygon(input)
}
