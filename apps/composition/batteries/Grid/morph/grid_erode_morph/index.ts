import { runGridMorph } from '../_morph/runGridMorph.ts'

export function gridErodeMorph(input: Record<string, unknown>) {
  return runGridMorph('erode', input)
}
