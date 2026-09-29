import { runGridArith } from '../_arith/runGridArith.ts'

export function gridAbs(input: Record<string, unknown>) {
  return runGridArith('abs', input)
}
