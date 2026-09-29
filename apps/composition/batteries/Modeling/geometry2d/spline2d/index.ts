import { buildSpline } from '../../../../../../packages/scene-authoring/src/types/operating.js'

export function spline2d(input: Record<string, unknown>): Record<string, unknown> {
  return buildSpline(input)
}
