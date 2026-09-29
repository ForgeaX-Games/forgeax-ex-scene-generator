import { runGridNoise } from '../_noise/runGridNoise.ts'

export function hashNoise(input: Record<string, unknown>): { grid: number[][] } {
  return runGridNoise({ ...input, kind: 'hash' })
}
