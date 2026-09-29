import { runGridArith } from '../_arith/runGridArith.ts'

export function gridMin(input: Record<string, unknown>) {
  return runGridArith('min', input)
}
