import {
  clampInt,
  gridSize,
  readGrid,
  unwrapNumber,
} from '../../_shared/lattice.ts'

function sampleNearest(grid: number[][], x: number, y: number): number {
  const { rows, columns } = gridSize(grid)
  const col = clampInt(x, 0, columns - 1, 0)
  const row = clampInt(y, 0, rows - 1, 0)
  return Number(grid[row]?.[col]) || 0
}

function sampleBilinear(grid: number[][], x: number, y: number): number {
  const { rows, columns } = gridSize(grid)
  if (rows === 0 || columns === 0) return 0
  const x0 = Math.max(0, Math.min(columns - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(rows - 1, Math.floor(y)))
  const x1 = Math.max(0, Math.min(columns - 1, x0 + 1))
  const y1 = Math.max(0, Math.min(rows - 1, y0 + 1))
  const tx = Math.min(1, Math.max(0, x - x0))
  const ty = Math.min(1, Math.max(0, y - y0))
  const v00 = Number(grid[y0]?.[x0]) || 0
  const v10 = Number(grid[y0]?.[x1]) || 0
  const v01 = Number(grid[y1]?.[x0]) || 0
  const v11 = Number(grid[y1]?.[x1]) || 0
  return v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty
}

export function runGridResize(input: Record<string, unknown>): {
  grid?: number[][]
  error?: string
} {
  const grid = readGrid(input.grid)
  if (!grid) return { error: 'gridResize requires a Grid' }
  const { rows: srcRows, columns: srcCols } = gridSize(grid)
  const columns = Math.round(unwrapNumber(input.columns, 0))
  const rows = Math.round(unwrapNumber(input.rows, 0))
  if (columns < 1 || rows < 1) return { error: 'gridResize requires positive columns and rows' }
  const mode = String(input.mode ?? 'bilinear') === 'nearest' ? 'nearest' : 'bilinear'
  const out: number[][] = []
  for (let j = 0; j < rows; j++) {
    const row: number[] = []
    const sy = srcRows === 1 ? 0 : (j + 0.5) * srcRows / rows - 0.5
    for (let i = 0; i < columns; i++) {
      const sx = srcCols === 1 ? 0 : (i + 0.5) * srcCols / columns - 0.5
      row.push(mode === 'nearest' ? sampleNearest(grid, sx, sy) : sampleBilinear(grid, sx, sy))
    }
    out.push(row)
  }
  return { grid: out }
}
