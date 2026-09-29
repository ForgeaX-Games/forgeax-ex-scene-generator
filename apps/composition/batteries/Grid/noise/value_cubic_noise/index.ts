import { runGridNoise } from '../_noise/runGridNoise.ts'

export function valueCubicNoise(input: Record<string, unknown>): { grid: number[][] } {
  return runGridNoise({ ...input, kind: 'valueCubic' })
}
