import { defineGenerator } from '@forgeax/scene'

function asGrid(value: unknown): number[][] | null {
  if (Array.isArray(value) && value.length > 0 && Array.isArray(value[0])) {
    return value.map((row) => (Array.isArray(row) ? row.map((cell) => Number(cell) || 0) : []))
  }
  if (value && typeof value === 'object') {
    const rec = value as { grid?: unknown }
    if (rec.grid !== undefined) return asGrid(rec.grid)
  }
  return null
}

function hashNoise(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 19.19) * 43758.5453
  return n - Math.floor(n)
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hashNoise(x0, y0, seed)
  const b = hashNoise(x0 + 1, y0, seed)
  const c = hashNoise(x0, y0 + 1, seed)
  const d = hashNoise(x0 + 1, y0 + 1, seed)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

export const rollHills = defineGenerator({
  id: 'roll-hills',
  description: 'Raise a bowl of hills from a valued grid.',
  inputs: {
    grid: { type: 'Grid', runtimeType: 'grid' },
    peak: { type: 'NumberValue', defaultValue: 22 },
    seed: { type: 'NumberValue', defaultValue: 3 },
  },
  outputs: { grid: { type: 'Grid', runtimeType: 'grid' } },
  run(_ctx, args: { grid: unknown; peak: number; seed: number }) {
    const source = asGrid(args.grid)
    if (!source) return { grid: [[0]] }
    const rows = source.length
    const cols = source[0]?.length ?? 0
    const peak = Number.isFinite(args.peak) ? Math.max(4, args.peak) : 22
    const seed = Number.isFinite(args.seed) ? args.seed : 3
    const grid = source.map((row, y) => row.map((cell, x) => {
      const nx = x / Math.max(1, cols - 1)
      const ny = y / Math.max(1, rows - 1)
      const ridge = valueNoise(nx * 3.1, ny * 3.1, seed)
      const detail = valueNoise(nx * 7.4, ny * 7.4, seed + 11) * 0.32
      const bowl = 1 - Math.min(1, ((nx - 0.48) ** 2 + (ny - 0.46) ** 2) * 3.2)
      return Math.max(1, cell + (ridge * 0.75 + detail + bowl * 0.6) * peak)
    }))
    return { grid }
  },
})
