import { runGridDerive } from '../_derive/runGridDerive.ts'

export function gridBBox(input: Record<string, unknown>) {
  return runGridDerive('bbox', input)
}
