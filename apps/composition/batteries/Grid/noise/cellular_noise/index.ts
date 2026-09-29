import { runGridNoise } from '../_noise/runGridNoise.ts'

export function cellularNoise(input: Record<string, unknown>): { grid: number[][] } {
  return runGridNoise({ ...input, kind: 'cellular' })
}
