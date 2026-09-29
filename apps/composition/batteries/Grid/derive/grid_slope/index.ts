import { runGridDerive } from '../_derive/runGridDerive.ts'

export function gridSlope(input: Record<string, unknown>) {
  return runGridDerive('slope', input)
}
