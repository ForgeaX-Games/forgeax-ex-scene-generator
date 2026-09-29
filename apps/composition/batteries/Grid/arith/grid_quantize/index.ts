import { runGridArith } from '../_arith/runGridArith.ts'

export function gridQuantize(input: Record<string, unknown>) {
  return runGridArith('quantize', input)
}
