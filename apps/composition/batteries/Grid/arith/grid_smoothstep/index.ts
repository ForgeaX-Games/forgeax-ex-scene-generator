import { runGridArith } from '../_arith/runGridArith.ts'

export function gridSmoothstep(input: Record<string, unknown>) {
  return runGridArith('smoothstep', input)
}
