import { runGridMorph } from '../_morph/runGridMorph.ts'

export function gridClose(input: Record<string, unknown>) {
  return runGridMorph('close', input)
}
