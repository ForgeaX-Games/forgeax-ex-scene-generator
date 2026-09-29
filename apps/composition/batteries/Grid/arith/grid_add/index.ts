import { runGridArith } from '../_arith/runGridArith.ts'

export function gridAdd(input: Record<string, unknown>) {
  return runGridArith('add', input)
}
