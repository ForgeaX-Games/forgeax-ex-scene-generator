import { diamondSquare } from '../_shared/fractal.ts'

export function gridDiamondSquare(input: Record<string, unknown>): { grid: number[][] } {
  return { grid: diamondSquare(input) }
}
