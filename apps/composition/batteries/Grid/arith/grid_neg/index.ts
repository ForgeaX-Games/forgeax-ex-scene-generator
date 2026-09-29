import { runGridArith } from '../_arith/runGridArith.ts'

export function gridNeg(input: Record<string, unknown>) {
  return runGridArith('neg', input)
}
