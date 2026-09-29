import { runGridMorph } from '../_morph/runGridMorph.ts'

export function gridOpen(input: Record<string, unknown>) {
  return runGridMorph('open', input)
}
