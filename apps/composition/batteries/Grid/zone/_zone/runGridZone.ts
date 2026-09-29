import { gridSize, readGrid, sameLattice } from '../../_shared/lattice.ts'

export function runGridZonalMean(input: Record<string, unknown>): {
  grid?: number[][]
  error?: string
} {
  const grid = readGrid(input.grid)
  const zones = readGrid(input.zones ?? input.ids)
  if (!grid || !zones) return { error: 'gridZonalMean requires a Grid and a zones Grid' }
  if (!sameLattice(grid, zones)) return { error: 'grids must share the same lattice' }
  const { rows, columns } = gridSize(grid)
  const sum = new Map<number, number>()
  const count = new Map<number, number>()
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      const zone = Number(zones[j]?.[i])
      if (!Number.isFinite(zone) || zone === 0) continue
      const value = Number(grid[j]?.[i])
      if (!Number.isFinite(value)) continue
      sum.set(zone, (sum.get(zone) ?? 0) + value)
      count.set(zone, (count.get(zone) ?? 0) + 1)
    }
  }
  const mean = new Map<number, number>()
  for (const [zone, total] of sum) {
    const n = count.get(zone) ?? 0
    if (n > 0) mean.set(zone, total / n)
  }
  const out = grid.map((row, j) => row.map((value, i) => {
    const zone = Number(zones[j]?.[i])
    return mean.get(zone) ?? (Number(value) || 0)
  }))
  return { grid: out }
}
