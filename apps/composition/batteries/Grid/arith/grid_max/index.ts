import { runGridArith } from '../_arith/runGridArith.ts'

export function gridMax(input: Record<string, unknown>) {
  return runGridArith('max', input)
}
