import { buildPolygon3d } from '../../../../../../packages/scene-authoring/src/types/operating.js'

export function polygon3d(input: Record<string, unknown>): Record<string, unknown> {
  return buildPolygon3d(input)
}
