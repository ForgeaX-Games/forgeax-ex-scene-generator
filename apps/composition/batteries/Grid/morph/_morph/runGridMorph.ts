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

export type MorphKind = 'dilate' | 'erode' | 'open' | 'close' | 'majority' | 'outline'

function radiusOf(input: Record<string, unknown>, fallback = 1): number {
  return clampInt(unwrapNumber(input.radius ?? input.thickness, fallback), 1, 16, fallback)
}

function connectivityOf(input: Record<string, unknown>): 4 | 8 {
  return unwrapNumber(input.connectivity, 8) === 4 ? 4 : 8
}

function extremum(
  grid: number[][],
  col: number,
  row: number,
  radius: number,
  connectivity: 4 | 8,
  mode: 'min' | 'max',
): number {
  let best = mode === 'min' ? Infinity : -Infinity
  for (let dj = -radius; dj <= radius; dj++) {
    for (let di = -radius; di <= radius; di++) {
      const manhattan = Math.abs(di) + Math.abs(dj)
      const chebyshev = Math.max(Math.abs(di), Math.abs(dj))
      if (connectivity === 4 && manhattan > radius) continue
      if (connectivity === 8 && chebyshev > radius) continue
      const v = at(grid, col + di, row + dj)
      best = mode === 'min' ? Math.min(best, v) : Math.max(best, v)
    }
  }
  return Number.isFinite(best) ? best : at(grid, col, row)
}

function dilate(grid: number[][], radius: number, connectivity: 4 | 8): number[][] {
  return mapGrid(grid, (_v, col, row) => extremum(grid, col, row, radius, connectivity, 'max'))
}

function erode(grid: number[][], radius: number, connectivity: 4 | 8): number[][] {
  return mapGrid(grid, (_v, col, row) => extremum(grid, col, row, radius, connectivity, 'min'))
}

export function runGridMorph(
  kind: MorphKind,
  input: Record<string, unknown>,
): { grid?: number[][]; error?: string } {
  const grid = readGrid(input.grid)
  if (!grid) return { error: `grid ${kind} requires a Grid` }
  const radius = radiusOf(input)
  const connectivity = connectivityOf(input)
  const { rows, columns } = gridSize(grid)
  let next: number[][]
  if (kind === 'dilate') next = dilate(grid, radius, connectivity)
  else if (kind === 'erode') next = erode(grid, radius, connectivity)
  else if (kind === 'open') next = dilate(erode(grid, radius, connectivity), radius, connectivity)
  else if (kind === 'close') next = erode(dilate(grid, radius, connectivity), radius, connectivity)
  else if (kind === 'majority') {
    next = mapGrid(grid, (_v, col, row) => {
      let ones = 0
      let count = 0
      for (let dj = -radius; dj <= radius; dj++) {
        for (let di = -radius; di <= radius; di++) {
          const chebyshev = Math.max(Math.abs(di), Math.abs(dj))
          if (chebyshev > radius) continue
          count += 1
          if (at(grid, col + di, row + dj) > 0.5) ones += 1
        }
      }
      return ones * 2 >= count ? 1 : 0
    })
  } else {
    const thickness = unwrapNumber(input.thickness, 1)
    const r = clampInt(Math.abs(thickness) || 1, 1, 16, 1)
    if (thickness < 0) {
      const fat = dilate(grid, r, connectivity)
      next = mapGrid(fat, (v, col, row) => Math.max(0, v - at(grid, col, row)))
    } else {
      const thin = erode(grid, r, connectivity)
      next = mapGrid(grid, (v, col, row) => Math.max(0, v - (Number(thin[row]?.[col]) || 0)))
    }
  }
  return { grid: applyMask(grid, next, readOptionalMask(input.mask, rows, columns)) }
}
