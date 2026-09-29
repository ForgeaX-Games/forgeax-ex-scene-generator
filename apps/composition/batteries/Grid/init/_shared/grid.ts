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

export function clampDim(value: number, fallback: number): number {
  const n = Math.round(value)
  if (!Number.isFinite(n) || n < 1) return fallback
  return Math.min(4096, n)
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

export function filledGrid(columns: number, rows: number, fill: number): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: columns }, () => fill))
}

export function normalize01(grid: number[][]): number[][] {
  let minVal = Infinity
  let maxVal = -Infinity
  for (const row of grid) {
    for (const cell of row) {
      if (cell < minVal) minVal = cell
      if (cell > maxVal) maxVal = cell
    }
  }
  const range = maxVal - minVal
  if (!(range > 0)) return grid
  return grid.map((row) => row.map((cell) => (cell - minVal) / range))
}

/** Deterministic LCG. seed <= 0 uses 48271, same as the archived diamond / midpoint kernels. */
export class GridLcg {
  private s: bigint
  constructor(seed: number) {
    const intSeed = Number.isFinite(seed) ? Math.floor(seed) : 0
    this.s = BigInt(intSeed > 0 ? intSeed : 48271)
  }
  next(): bigint {
    this.s = (this.s * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn
    return this.s
  }
  float(): number {
    return Number((this.next() >> 33n) % 1000000n) / 500000 - 1
  }
}
