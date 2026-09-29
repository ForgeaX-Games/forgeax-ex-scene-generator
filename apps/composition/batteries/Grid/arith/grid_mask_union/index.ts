import { runGridArith } from '../_arith/runGridArith.ts'

export function gridMaskUnion(input: Record<string, unknown>) {
  return runGridArith('maskUnion', input)
}
