import { clampDim, clampInt, unwrapNumber } from '../../init/_shared/grid.ts'
import { sampleFractal } from './common.ts'
import { hashCell } from './hash.ts'
import {
  parseCellularDistance,
  parseCellularReturn,
  singleCellularR2,
  singleOpenSimplex2R2,
  singleOpenSimplex2SR2,
  singlePerlinR2,
  singleValueCubicR2,
  singleValueR2,
  skewOpenSimplex,
  type CellularDistance,
  type CellularReturn,
} from './samplers.ts'

export const GRID_NOISE_KINDS = [
  'hash',
  'value',
  'valueCubic',
  'perlin',
  'opensimplex2',
  'opensimplex2s',
  'cellular',
] as const

export type GridNoiseKind = (typeof GRID_NOISE_KINDS)[number]
export type GridNoiseFractal = 'none' | 'fbm' | 'ridged' | 'pingpong'

const DEFAULT_SEED = 1337
const DEFAULT_FREQUENCY = 0.08

function parseKind(value: unknown): GridNoiseKind {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (text === 'valuecubic' || text === 'value_cubic') return 'valueCubic'
  if (text === 'opensimplex2s' || text === 'opensimplex2_s') return 'opensimplex2s'
  if (text === 'opensimplex2' || text === 'opensimplex') return 'opensimplex2'
  if (GRID_NOISE_KINDS.includes(text as GridNoiseKind)) return text as GridNoiseKind
  return 'perlin'
}

function parseFractal(value: unknown): GridNoiseFractal {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (text === 'fbm') return 'fbm'
  if (text === 'ridged') return 'ridged'
  if (text === 'pingpong' || text === 'ping_pong') return 'pingpong'
  return 'none'
}

function noiseSeed(value: unknown): number {
  const n = Math.floor(unwrapNumber(value, DEFAULT_SEED))
  return n > 0 ? n : DEFAULT_SEED
}

function map01(raw: number): number {
  return raw * 0.5 + 0.5
}

function sampledGrid(
  columns: number,
  rows: number,
  frequency: number,
  offsetX: number,
  offsetY: number,
  sample: (x: number, y: number) => number,
): number[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: columns }, (_, c) => map01(sample((c + offsetX) * frequency, (r + offsetY) * frequency))))
}

export function runGridNoise(input: Record<string, unknown>): { grid: number[][] } {
  const kind = parseKind(input.kind)
  const columns = clampDim(unwrapNumber(input.columns, 16), 16)
  const rows = clampDim(unwrapNumber(input.rows, 16), 16)
  const seed = noiseSeed(input.seed)
  if (kind === 'hash') {
    const scale = unwrapNumber(input.scale, 1)
    const freq = scale > 0 ? scale : 1
    const grid = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: columns }, (_, c) => hashCell(Math.floor(r * freq), Math.floor(c * freq), seed)))
    return { grid }
  }
  const frequency = unwrapNumber(input.frequency, DEFAULT_FREQUENCY)
  const fractal = parseFractal(input.fractal)
  const octaves = clampInt(unwrapNumber(input.octaves, 4), 1, 8, 4)
  const lacunarity = unwrapNumber(input.lacunarity, 2)
  const gain = unwrapNumber(input.gain, 0.5)
  const offsetX = unwrapNumber(input.offsetX, 0)
  const offsetY = unwrapNumber(input.offsetY, 0)
  if (kind === 'cellular') {
    const jitter = Math.min(1, Math.max(0, unwrapNumber(input.jitter, 1)))
    const distanceFunction: CellularDistance = parseCellularDistance(input.distanceFunction)
    const returnType: CellularReturn = parseCellularReturn(input.returnType)
    return {
      grid: sampledGrid(columns, rows, frequency, offsetX, offsetY, (x, y) =>
        sampleFractal(
          (s, sx, sy) => singleCellularR2(s, sx, sy, jitter, distanceFunction, returnType),
          fractal,
          seed,
          x,
          y,
          octaves,
          lacunarity,
          gain,
        )),
    }
  }
  const sample =
    kind === 'value' ? singleValueR2
      : kind === 'valueCubic' ? singleValueCubicR2
        : kind === 'opensimplex2' ? singleOpenSimplex2R2
          : kind === 'opensimplex2s' ? singleOpenSimplex2SR2
            : singlePerlinR2
  const skew = kind === 'opensimplex2' || kind === 'opensimplex2s'
  return {
    grid: sampledGrid(columns, rows, frequency, offsetX, offsetY, (x, y) => {
      const point = skew ? skewOpenSimplex(x, y) : { x, y }
      return sampleFractal(sample, fractal, seed, point.x, point.y, octaves, lacunarity, gain)
    }),
  }
}
