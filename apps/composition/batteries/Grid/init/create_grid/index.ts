import { clampDim, filledGrid, unwrapNumber } from '../_shared/grid.ts'

export function createGrid(input: Record<string, unknown>): { grid: number[][] } {
  const columns = clampDim(unwrapNumber(input.columns, 16), 16)
  const rows = clampDim(unwrapNumber(input.rows, 16), 16)
  const fill = unwrapNumber(input.fill, 0)
  return { grid: filledGrid(columns, rows, fill) }
}
