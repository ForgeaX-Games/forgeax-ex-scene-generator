/** Same-lattice helpers for Grid arith / filter / morph / derive. */

export function unwrapNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value) && value.length > 0) return unwrapNumber(value[0], fallback)
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    if (Array.isArray(rec.items)) return unwrapNumber(rec.items[0], fallback)
    if (rec.value !== undefined) return unwrapNumber(rec.value, fallback)
    if (rec.grid !== undefined && rec.grid !== value) return unwrapNumber(rec.grid, fallback)
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function clampInt(value: number, min: number, max: number, fallback: number): number {
  const n = Math.round(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function readGrid(value: unknown): number[][] | undefined {
  if (Array.isArray(value) && value.length > 0 && Array.isArray(value[0])) {
    return value as number[][]
  }
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    if (rec.grid !== undefined && rec.grid !== value) return readGrid(rec.grid)
  }
  return undefined
}

export function gridSize(grid: number[][]): { rows: number; columns: number } {
  const rows = grid.length
  const columns = grid.reduce((max, row) => (Array.isArray(row) && row.length > max ? row.length : max), 0)
  return { rows, columns }
}

export function sameLattice(a: number[][], b: number[][]): boolean {
  const left = gridSize(a)
  const right = gridSize(b)
  return left.rows === right.rows && left.columns === right.columns && left.rows > 0 && left.columns > 0
}

export function cloneGrid(grid: number[][]): number[][] {
  return grid.map((row) => row.slice())
}

export function mapGrid(grid: number[][], fn: (value: number, col: number, row: number) => number): number[][] {
  return grid.map((row, j) => row.map((value, i) => fn(value, i, j)))
}

export function readOptionalMask(value: unknown, rows: number, columns: number): number[][] | undefined {
  if (value == null) return undefined
  const mask = readGrid(value)
  if (!mask) return undefined
  const size = gridSize(mask)
  if (size.rows !== rows || size.columns !== columns) return undefined
  return mask
}

/** lerp(src, next, mask). Missing mask keeps `next`. */
export function applyMask(src: number[][], next: number[][], mask?: number[][]): number[][] {
  if (!mask) return next
  return next.map((row, j) => row.map((value, i) => {
    const t = Number(mask[j]?.[i]) || 0
    const prev = Number(src[j]?.[i]) || 0
    return prev * (1 - t) + value * t
  }))
}

export type GridOrScalar = { kind: 'grid'; grid: number[][] } | { kind: 'scalar'; value: number }

export function readGridOrScalar(value: unknown): GridOrScalar | undefined {
  const grid = readGrid(value)
  if (grid) return { kind: 'grid', grid }
  if (value == null) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) return { kind: 'scalar', value }
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>
    if (rec.value !== undefined && rec.grid === undefined) {
      const n = unwrapNumber(rec.value, Number.NaN)
      if (Number.isFinite(n)) return { kind: 'scalar', value: n }
    }
  }
  const n = Number(value)
  return Number.isFinite(n) ? { kind: 'scalar', value: n } : undefined
}

export function at(grid: number[][], col: number, row: number): number {
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  const j = Math.min(rows - 1, Math.max(0, row))
  const i = Math.min(cols - 1, Math.max(0, col))
  return Number(grid[j]?.[i]) || 0
}
