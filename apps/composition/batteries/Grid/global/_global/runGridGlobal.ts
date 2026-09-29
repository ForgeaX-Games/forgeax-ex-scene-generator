import {
  gridSize,
  readGrid,
  sameLattice,
} from '../../_shared/lattice.ts'

const UNREACHABLE = 1e9

function connectivityOf(input: Record<string, unknown>): 4 | 8 {
  const raw = Number(input.connectivity)
  return raw === 4 ? 4 : 8
}

function neighbors(col: number, row: number, connectivity: 4 | 8): Array<[number, number]> {
  const out: Array<[number, number]> = [
    [col - 1, row],
    [col + 1, row],
    [col, row - 1],
    [col, row + 1],
  ]
  if (connectivity === 8) {
    out.push(
      [col - 1, row - 1],
      [col + 1, row - 1],
      [col - 1, row + 1],
      [col + 1, row + 1],
    )
  }
  return out
}

export function runGridStats(input: Record<string, unknown>): {
  min?: number
  max?: number
  mean?: number
  sum?: number
  count?: number
  coverage?: number
  error?: string
} {
  const grid = readGrid(input.grid)
  if (!grid) return { error: 'gridStats requires a Grid' }
  const { rows, columns } = gridSize(grid)
  const total = Math.max(1, rows * columns)
  const mask = input.mask == null ? undefined : readGrid(input.mask)
  if (input.mask != null && (!mask || !sameLattice(grid, mask))) {
    return { error: 'grids must share the same lattice' }
  }
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let count = 0
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      if (mask && !(Number(mask[j]?.[i]) > 0)) continue
      const value = Number(grid[j]?.[i])
      if (!Number.isFinite(value)) continue
      min = Math.min(min, value)
      max = Math.max(max, value)
      sum += value
      count++
    }
  }
  if (count === 0) return { min: 0, max: 0, mean: 0, sum: 0, count: 0, coverage: 0 }
  return { min, max, mean: sum / count, sum, count, coverage: count / total }
}

export function runGridDistance(input: Record<string, unknown>): {
  grid?: number[][]
  error?: string
} {
  const seeds = readGrid(input.seeds ?? input.grid)
  if (!seeds) return { error: 'gridDistance requires a seeds Grid' }
  const { rows, columns } = gridSize(seeds)
  const walk = input.mask == null ? undefined : readGrid(input.mask)
  if (input.mask != null && (!walk || !sameLattice(seeds, walk))) {
    return { error: 'grids must share the same lattice' }
  }
  const connectivity = connectivityOf(input)
  const walkable = (col: number, row: number) => {
    if (col < 0 || row < 0 || col >= columns || row >= rows) return false
    if (walk && !(Number(walk[row]?.[col]) > 0)) return false
    return true
  }
  const dist = Array.from({ length: rows }, () => Array.from({ length: columns }, () => UNREACHABLE))
  const queue: Array<[number, number]> = []
  let head = 0
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      if (!(Number(seeds[j]?.[i]) > 0) || !walkable(i, j)) continue
      dist[j]![i] = 0
      queue.push([i, j])
    }
  }
  while (head < queue.length) {
    const [col, row] = queue[head]!
    head++
    const here = dist[row]![col]!
    for (const [nc, nr] of neighbors(col, row, connectivity)) {
      if (!walkable(nc, nr)) continue
      if (dist[nr]![nc]! <= here + 1) continue
      dist[nr]![nc] = here + 1
      queue.push([nc, nr])
    }
  }
  return { grid: dist }
}

export { UNREACHABLE }
