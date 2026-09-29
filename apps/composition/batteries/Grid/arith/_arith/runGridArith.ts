import {
  applyMask,
  gridSize,
  mapGrid,
  readGrid,
  readGridOrScalar,
  readOptionalMask,
  sameLattice,
  unwrapNumber,
} from '../../_shared/lattice.ts'

export type ArithKind =
  | 'add'
  | 'sub'
  | 'mul'
  | 'min'
  | 'max'
  | 'lerp'
  | 'choose'
  | 'maskDiff'
  | 'maskUnion'
  | 'abs'
  | 'neg'
  | 'clamp'
  | 'remap'
  | 'smoothstep'
  | 'quantize'

const BINARY: ReadonlySet<ArithKind> = new Set(['add', 'sub', 'mul', 'min', 'max', 'maskDiff', 'maskUnion'])

function binaryOp(kind: ArithKind, left: number, right: number): number {
  switch (kind) {
    case 'add': return left + right
    case 'sub': return left - right
    case 'mul': return left * right
    case 'min': return Math.min(left, right)
    case 'max': return Math.max(left, right)
    case 'maskDiff': return (left !== 0 && right === 0) ? 1 : 0
    case 'maskUnion': return (left !== 0 || right !== 0) ? 1 : 0
    default: return left
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x >= edge1 ? 1 : 0
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

export function runGridArith(
  kind: ArithKind,
  input: Record<string, unknown>,
): { grid?: number[][]; error?: string } {
  if (BINARY.has(kind)) {
    const a = readGrid(input.a ?? input.grid)
    const b = readGridOrScalar(input.b ?? input.value)
    if (!a || !b) return { error: `grid ${kind} requires a Grid and a Grid (b) or number (value)` }
    if (b.kind === 'grid' && !sameLattice(a, b.grid)) return { error: 'grids must share the same lattice' }
    const { rows, columns } = gridSize(a)
    // Lattice already validated above; sampling per cell must not re-check it.
    const next = b.kind === 'grid'
      ? ((right) => mapGrid(a, (left, col, row) =>
          binaryOp(kind, Number(left) || 0, Number(right[row]?.[col]) || 0)))(b.grid)
      : ((right) => mapGrid(a, (left) => binaryOp(kind, Number(left) || 0, right)))(b.value)
    return { grid: applyMask(a, next, readOptionalMask(input.mask, rows, columns)) }
  }

  if (kind === 'lerp') {
    const a = readGrid(input.a)
    const b = readGrid(input.b)
    if (!a || !b) return { error: 'gridLerp requires two Grids' }
    if (!sameLattice(a, b)) return { error: 'grids must share the same lattice' }
    const tRaw = readGridOrScalar(input.weight ?? input.t ?? 0.5)
    if (!tRaw) return { error: 'gridLerp requires t as a number, or weight as a Grid' }
    if (tRaw.kind === 'grid' && !sameLattice(a, tRaw.grid)) return { error: 'grids must share the same lattice' }
    const { rows, columns } = gridSize(a)
    const next = mapGrid(a, (left, col, row) => {
      const right = Number(b[row]?.[col]) || 0
      const t = tRaw.kind === 'grid' ? (Number(tRaw.grid[row]?.[col]) || 0) : tRaw.value
      return left * (1 - t) + right * t
    })
    return { grid: applyMask(a, next, readOptionalMask(input.mask, rows, columns)) }
  }

  if (kind === 'choose') {
    const a = readGrid(input.a)
    const b = readGrid(input.b)
    const mask = readGrid(input.mask)
    if (!a || !b || !mask) return { error: 'gridChoose requires a, b, and mask Grids' }
    if (!sameLattice(a, b) || !sameLattice(a, mask)) return { error: 'grids must share the same lattice' }
    return {
      grid: mapGrid(a, (left, col, row) => {
        const t = Number(mask[row]?.[col]) || 0
        return t > 0.5 ? (Number(b[row]?.[col]) || 0) : left
      }),
    }
  }

  const grid = readGrid(input.grid ?? input.a)
  if (!grid) return { error: `grid ${kind} requires a Grid` }
  const { rows, columns } = gridSize(grid)

  if (kind === 'abs') {
    return { grid: applyMask(grid, mapGrid(grid, (v) => Math.abs(v)), readOptionalMask(input.mask, rows, columns)) }
  }
  if (kind === 'neg') {
    return { grid: applyMask(grid, mapGrid(grid, (v) => -v), readOptionalMask(input.mask, rows, columns)) }
  }
  if (kind === 'clamp') {
    const lo = unwrapNumber(input.min, 0)
    const hi = unwrapNumber(input.max, 1)
    const minV = Math.min(lo, hi)
    const maxV = Math.max(lo, hi)
    return {
      grid: applyMask(grid, mapGrid(grid, (v) => Math.min(maxV, Math.max(minV, v))), readOptionalMask(input.mask, rows, columns)),
    }
  }
  if (kind === 'remap') {
    const fromPair = Array.isArray(input.from) ? input.from : [input.fromMin, input.fromMax]
    const toPair = Array.isArray(input.to) ? input.to : [input.toMin, input.toMax]
    const from0 = unwrapNumber(fromPair[0], 0)
    const from1 = unwrapNumber(fromPair[1], 1)
    const to0 = unwrapNumber(toPair[0], 0)
    const to1 = unwrapNumber(toPair[1], 1)
    const span = from1 - from0
    const next = mapGrid(grid, (v) => {
      const t = span === 0 ? 0 : (v - from0) / span
      return to0 + t * (to1 - to0)
    })
    return { grid: applyMask(grid, next, readOptionalMask(input.mask, rows, columns)) }
  }
  if (kind === 'smoothstep') {
    const edge0 = unwrapNumber(input.edge0, 0)
    const edge1 = unwrapNumber(input.edge1, 1)
    return {
      grid: applyMask(grid, mapGrid(grid, (v) => smoothstep(edge0, edge1, v)), readOptionalMask(input.mask, rows, columns)),
    }
  }
  const steps = Math.max(1, Math.round(unwrapNumber(input.steps, 4)))
  const next = mapGrid(grid, (v) => Math.round(v * steps) / steps)
  return { grid: applyMask(grid, next, readOptionalMask(input.mask, rows, columns)) }
}
