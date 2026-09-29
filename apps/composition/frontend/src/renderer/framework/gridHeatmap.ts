// Scalar-field colors for Grid preview overlays.
//
// Voxel Output still uses `colorForValue` (golden-angle token hues). A height /
// noise / mask Grid is a continuous field: neighbors must look related, 0 must
// sit in the middle, and negatives must read as the other side of zero.
//
// Card is a transparent diverging ramp on the dark workbench:
//   negative → sky blue,  zero → fog,  positive → amber.

import type { RGBA } from './palette'

export interface GridFieldRange {
  min: number
  max: number
}

interface HeatStop {
  t: number
  r: number
  g: number
  b: number
  a: number
}

const STOPS: readonly HeatStop[] = [
  { t: -1, r: 29, g: 78, b: 216, a: 102 },
  { t: -0.45, r: 125, g: 211, b: 252, a: 97 },
  { t: 0, r: 248, g: 250, b: 252, a: 28 },
  { t: 0.45, r: 253, g: 230, b: 138, a: 102 },
  { t: 1, r: 245, g: 158, b: 11, a: 128 },
]

const EMPTY: RGBA = { r: 0, g: 0, b: 0, a: 0 }

export function gridFieldRange(data: readonly (readonly number[] | undefined)[]): GridFieldRange | null {
  let min = Infinity
  let max = -Infinity
  for (const row of data) {
    if (!row) continue
    for (const value of row) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      if (value < min) min = value
      if (value > max) max = value
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  return { min, max }
}

/** Map a cell onto [-1, 1]. Diverges around 0 when the field crosses zero. */
export function signedGridUnit(value: number, range: GridFieldRange): number {
  if (!Number.isFinite(value)) return 0
  const { min, max } = range
  if (min < 0 && max > 0) {
    if (value < 0) return value / -min
    if (value > 0) return value / max
    return 0
  }
  if (max <= 0) {
    if (min === max) return value < 0 ? -1 : 0
    return (value - max) / (max - min)
  }
  if (min === max) return value > 0 ? 1 : 0
  return (value - min) / (max - min)
}

function lerpStop(a: HeatStop, b: HeatStop, t: number): RGBA {
  const u = (t - a.t) / (b.t - a.t)
  return {
    r: Math.round(a.r + (b.r - a.r) * u),
    g: Math.round(a.g + (b.g - a.g) * u),
    b: Math.round(a.b + (b.b - a.b) * u),
    a: Math.round(a.a + (b.a - a.a) * u),
  }
}

export function colorForGridUnit(t: number): RGBA {
  const x = Math.min(1, Math.max(-1, t))
  for (let i = 1; i < STOPS.length; i++) {
    const right = STOPS[i]!
    if (x <= right.t) return lerpStop(STOPS[i - 1]!, right, x)
  }
  const last = STOPS[STOPS.length - 1]!
  return { r: last.r, g: last.g, b: last.b, a: last.a }
}

export function colorForGridValue(value: number, range: GridFieldRange | null): RGBA {
  if (range === null || typeof value !== 'number' || !Number.isFinite(value)) return EMPTY
  return colorForGridUnit(signedGridUnit(value, range))
}
