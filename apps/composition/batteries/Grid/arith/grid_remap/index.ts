import { runGridArith } from '../_arith/runGridArith.ts'

export function gridRemap(input: Record<string, unknown>) {
  return runGridArith('remap', input)
}
