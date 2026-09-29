import { midpointDisplacement } from '../_shared/fractal.ts'

export function gridMidpoint(input: Record<string, unknown>): { grid: number[][] } {
  return { grid: midpointDisplacement(input) }
}
