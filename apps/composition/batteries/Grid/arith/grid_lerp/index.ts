import { runGridArith } from '../_arith/runGridArith.ts'

export function gridLerp(input: Record<string, unknown>) {
  return runGridArith('lerp', input)
}
