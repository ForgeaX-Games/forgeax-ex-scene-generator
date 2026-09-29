import { runGridArith } from '../_arith/runGridArith.ts'

export function gridChoose(input: Record<string, unknown>) {
  return runGridArith('choose', input)
}
