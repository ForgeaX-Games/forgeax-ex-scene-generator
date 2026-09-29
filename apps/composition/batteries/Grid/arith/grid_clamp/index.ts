import { runGridArith } from '../_arith/runGridArith.ts'

export function gridClamp(input: Record<string, unknown>) {
  return runGridArith('clamp', input)
}
