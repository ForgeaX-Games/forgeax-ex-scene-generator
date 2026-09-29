import { runGridNoise } from '../_noise/runGridNoise.ts'

export function valueNoise(input: Record<string, unknown>): { grid: number[][] } {
  return runGridNoise({ ...input, kind: 'value' })
}
