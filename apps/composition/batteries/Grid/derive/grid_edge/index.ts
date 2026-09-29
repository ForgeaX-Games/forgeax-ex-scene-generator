import { runGridDerive } from '../_derive/runGridDerive.ts'

export function gridEdge(input: Record<string, unknown>) {
  return runGridDerive('edge', input)
}
