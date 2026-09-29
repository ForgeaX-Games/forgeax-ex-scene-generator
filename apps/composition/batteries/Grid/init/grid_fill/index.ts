import { readGrid, unwrapNumber } from '../_shared/grid.ts'

export function gridFill(input: Record<string, unknown>): { grid?: number[][]; error?: string } {
  const src = readGrid(input.grid)
  if (!src || src.length === 0 || (src[0]?.length ?? 0) === 0) {
    return { error: 'gridFill requires a Grid' }
  }
  const fill = unwrapNumber(input.fill, 0)
  return { grid: src.map((row) => row.map(() => fill)) }
}
