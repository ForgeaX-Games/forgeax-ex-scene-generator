import { runGridDerive } from '../_derive/runGridDerive.ts'

export function gridAspect(input: Record<string, unknown>) {
  return runGridDerive('aspect', input)
}
