import { runGridNoise } from '../_noise/runGridNoise.ts'

export function openSimplex2Noise(input: Record<string, unknown>): { grid: number[][] } {
  return runGridNoise({ ...input, kind: 'opensimplex2' })
}
