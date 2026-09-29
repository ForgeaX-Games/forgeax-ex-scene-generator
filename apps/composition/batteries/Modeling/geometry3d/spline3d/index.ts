import { buildSpline3d } from '../../../../../../packages/scene-authoring/src/types/operating.js'

export function spline3d(input: Record<string, unknown>): Record<string, unknown> {
  return buildSpline3d(input)
}
