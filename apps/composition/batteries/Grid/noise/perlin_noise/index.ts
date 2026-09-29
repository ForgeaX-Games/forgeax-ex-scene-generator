import { runGridNoise } from '../_noise/runGridNoise.ts'

export function perlinNoise(input: Record<string, unknown>): { grid: number[][] } {
  return runGridNoise({ ...input, kind: 'perlin' })
}
