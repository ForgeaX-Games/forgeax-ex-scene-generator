import { runGridArith } from '../_arith/runGridArith.ts'

export function gridMul(input: Record<string, unknown>) {
  return runGridArith('mul', input)
}
