import { runGridDerive } from '../_derive/runGridDerive.ts'

export function gridThreshold(input: Record<string, unknown>) {
  return runGridDerive('threshold', input)
}
