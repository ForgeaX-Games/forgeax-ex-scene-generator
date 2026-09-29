import { clampDim, unwrapNumber } from '../_shared/grid.ts'

const KINDS = new Set(['row', 'col', 'radial'])

function kindOf(value: unknown): 'row' | 'col' | 'radial' {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (text === 'column' || text === 'x') return 'col'
  if (text === 'y') return 'row'
  return KINDS.has(text) ? text as 'row' | 'col' | 'radial' : 'row'
}

function unit(index: number, count: number): number {
  return count <= 1 ? 0 : index / (count - 1)
}

export function gridGradient(input: Record<string, unknown>): { grid: number[][] } {
  const columns = clampDim(unwrapNumber(input.columns, 16), 16)
  const rows = clampDim(unwrapNumber(input.rows, 16), 16)
  const kind = kindOf(input.kind)
  const cx = (columns - 1) / 2
  const cy = (rows - 1) / 2
  const maxR = Math.hypot(cx, cy) || 1
  const grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: columns }, (_, c) => {
      if (kind === 'col') return unit(c, columns)
      if (kind === 'radial') return Math.hypot(c - cx, r - cy) / maxR
      return unit(r, rows)
    }))
  return { grid }
}
