import { runGridDerive } from '../_derive/runGridDerive.ts'

export function gridCurvature(input: Record<string, unknown>) {
  return runGridDerive('curvature', input)
}
