import {
  at,
  gridSize,
  mapGrid,
  readGrid,
  unwrapNumber,
} from '../../_shared/lattice.ts'

export type DeriveKind = 'slope' | 'aspect' | 'curvature' | 'threshold' | 'range' | 'edge' | 'bbox'

export function runGridDerive(
  kind: DeriveKind,
  input: Record<string, unknown>,
): { grid?: number[][]; columns?: number; rows?: number; col?: number; row?: number; error?: string } {
  const grid = readGrid(input.grid)
  if (!grid) return { error: `grid ${kind} requires a Grid` }
  const { rows, columns } = gridSize(grid)

  if (kind === 'bbox') {
    let minC = columns
    let maxC = -1
    let minR = rows
    let maxR = -1
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < columns; i++) {
        if ((Number(grid[j]?.[i]) || 0) === 0) continue
        minC = Math.min(minC, i)
        maxC = Math.max(maxC, i)
        minR = Math.min(minR, j)
        maxR = Math.max(maxR, j)
      }
    }
    if (maxC < 0) return { columns: 0, rows: 0, col: 0, row: 0 }
    return { columns: maxC - minC + 1, rows: maxR - minR + 1, col: minC, row: minR }
  }

  if (kind === 'threshold') {
    const value = unwrapNumber(input.value, 0.5)
    return { grid: mapGrid(grid, (v) => (v >= value ? 1 : 0)) }
  }
  if (kind === 'range') {
    const lo = unwrapNumber(input.min, 0)
    const hi = unwrapNumber(input.max, 1)
    const minV = Math.min(lo, hi)
    const maxV = Math.max(lo, hi)
    return { grid: mapGrid(grid, (v) => (v >= minV && v <= maxV ? 1 : 0)) }
  }
  if (kind === 'edge') {
    return {
      grid: mapGrid(grid, (v, col, row) => {
        const n = at(grid, col, row - 1)
        const s = at(grid, col, row + 1)
        const w = at(grid, col - 1, row)
        const e = at(grid, col + 1, row)
        return Math.max(Math.abs(v - n), Math.abs(v - s), Math.abs(v - w), Math.abs(v - e))
      }),
    }
  }
  if (kind === 'slope') {
    return {
      grid: mapGrid(grid, (_v, col, row) => {
        const dx = (at(grid, col + 1, row) - at(grid, col - 1, row)) * 0.5
        const dy = (at(grid, col, row + 1) - at(grid, col, row - 1)) * 0.5
        return Math.hypot(dx, dy)
      }),
    }
  }
  if (kind === 'aspect') {
    return {
      grid: mapGrid(grid, (_v, col, row) => {
        const dx = (at(grid, col + 1, row) - at(grid, col - 1, row)) * 0.5
        const dy = (at(grid, col, row + 1) - at(grid, col, row - 1)) * 0.5
        const deg = Math.atan2(dy, dx) * 180 / Math.PI
        return (deg + 360) % 360
      }),
    }
  }
  return {
    grid: mapGrid(grid, (v, col, row) => {
      const n = at(grid, col, row - 1)
      const s = at(grid, col, row + 1)
      const w = at(grid, col - 1, row)
      const e = at(grid, col + 1, row)
      return n + s + w + e - 4 * v
    }),
  }
}
