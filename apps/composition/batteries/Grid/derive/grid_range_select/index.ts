import { runGridDerive } from '../_derive/runGridDerive.ts'

export function gridRangeSelect(input: Record<string, unknown>) {
  return runGridDerive('range', input)
}
