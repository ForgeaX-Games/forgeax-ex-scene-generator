import {
  applyMask,
  at,
  clampInt,
  gridSize,
  mapGrid,
  readGrid,
  readOptionalMask,
  unwrapNumber,
} from '../../_shared/lattice.ts'

export type FilterKind = 'blur' | 'sharpen' | 'median' | 'nmin' | 'nmax'

function radiusOf(input: Record<string, unknown>): number {
  return clampInt(unwrapNumber(input.radius, 1), 1, 16, 1)
}

function neighborhood(grid: number[][], col: number, row: number, radius: number, connectivity: 4 | 8): number[] {
  const values: number[] = []
  for (let dj = -radius; dj <= radius; dj++) {
    for (let di = -radius; di <= radius; di++) {
      if (connectivity === 4 && Math.abs(di) + Math.abs(dj) > radius) continue
      if (connectivity === 8 && Math.max(Math.abs(di), Math.abs(dj)) > radius) continue
      values.push(at(grid, col + di, row + dj))
    }
  }
  return values
}

function gaussianWeight(di: number, dj: number, sigma: number): number {
  const s2 = 2 * sigma * sigma
  return Math.exp(-(di * di + dj * dj) / s2)
}

function blurCell(grid: number[][], col: number, row: number, radius: number, kind: string): number {
  if (kind === 'gaussian') {
    const sigma = Math.max(0.5, radius / 2)
    let sum = 0
    let wsum = 0
    for (let dj = -radius; dj <= radius; dj++) {
      for (let di = -radius; di <= radius; di++) {
        const w = gaussianWeight(di, dj, sigma)
        sum += at(grid, col + di, row + dj) * w
        wsum += w
      }
    }
    return wsum > 0 ? sum / wsum : at(grid, col, row)
  }
  const values = neighborhood(grid, col, row, radius, 8)
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function runGridFilter(
  kind: FilterKind,
  input: Record<string, unknown>,
): { grid?: number[][]; error?: string } {
  const grid = readGrid(input.grid)
  if (!grid) return { error: `grid ${kind} requires a Grid` }
  const radius = radiusOf(input)
  const { rows, columns } = gridSize(grid)
  let next: number[][]
  if (kind === 'blur') {
    const blurKind = String(input.kind ?? 'box')
    next = mapGrid(grid, (_v, col, row) => blurCell(grid, col, row, radius, blurKind))
  } else if (kind === 'sharpen') {
    const amount = unwrapNumber(input.amount, 1)
    next = mapGrid(grid, (v, col, row) => {
      const blurred = blurCell(grid, col, row, radius, 'box')
      return v + amount * (v - blurred)
    })
  } else if (kind === 'median') {
    next = mapGrid(grid, (_v, col, row) => {
      const values = neighborhood(grid, col, row, radius, 8).sort((a, b) => a - b)
      const mid = Math.floor(values.length / 2)
      return values.length % 2 === 1 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2
    })
  } else if (kind === 'nmin') {
    next = mapGrid(grid, (_v, col, row) => Math.min(...neighborhood(grid, col, row, radius, 8)))
  } else {
    next = mapGrid(grid, (_v, col, row) => Math.max(...neighborhood(grid, col, row, radius, 8)))
  }
  return { grid: applyMask(grid, next, readOptionalMask(input.mask, rows, columns)) }
}
