import { runGridMorph } from '../_morph/runGridMorph.ts'

export function gridOutline(input: Record<string, unknown>) {
  return runGridMorph('outline', input)
}
