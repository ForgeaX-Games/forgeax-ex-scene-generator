import { runGridMorph } from '../_morph/runGridMorph.ts'

export function gridDilate(input: Record<string, unknown>) {
  return runGridMorph('dilate', input)
}
