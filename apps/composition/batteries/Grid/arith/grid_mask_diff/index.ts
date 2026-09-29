import { runGridArith } from '../_arith/runGridArith.ts'

export function gridMaskDiff(input: Record<string, unknown>) {
  return runGridArith('maskDiff', input)
}
