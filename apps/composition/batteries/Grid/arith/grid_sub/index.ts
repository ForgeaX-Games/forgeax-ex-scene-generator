import { runGridArith } from '../_arith/runGridArith.ts'

export function gridSub(input: Record<string, unknown>) {
  return runGridArith('sub', input)
}
