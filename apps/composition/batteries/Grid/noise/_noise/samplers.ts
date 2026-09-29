import { RAND_VECS_2D } from './tables.ts'
import {
  F2,
  G2,
  PRIME_X,
  PRIME_Y,
  cubicLerp,
  gradCoordR2,
  hashR2,
  interpHermite,
  interpQuintic,
  lerp,
  valCoordR2,
} from './common.ts'

export function singleValueR2(seed: number, x: number, y: number): number {
  let x0 = Math.floor(x)
  let y0 = Math.floor(y)
  const xs = interpHermite(x - x0)
  const ys = interpHermite(y - y0)
  x0 = Math.imul(x0, PRIME_X)
  y0 = Math.imul(y0, PRIME_Y)
  const x1 = x0 + PRIME_X
  const y1 = y0 + PRIME_Y
  const xf0 = lerp(valCoordR2(seed, x0, y0), valCoordR2(seed, x1, y0), xs)
  const xf1 = lerp(valCoordR2(seed, x0, y1), valCoordR2(seed, x1, y1), xs)
  return lerp(xf0, xf1, ys)
}

export function singleValueCubicR2(seed: number, x: number, y: number): number {
  let x1 = Math.floor(x)
  let y1 = Math.floor(y)
  const xs = x - x1
  const ys = y - y1
  x1 = Math.imul(x1, PRIME_X)
  y1 = Math.imul(y1, PRIME_Y)
  const x0 = x1 - PRIME_X
  const y0 = y1 - PRIME_Y
  const x2 = x1 + PRIME_X
  const y2 = y1 + PRIME_Y
  const x3 = x1 + (PRIME_X << 1)
  const y3 = y1 + (PRIME_Y << 1)
  return (
    cubicLerp(
      cubicLerp(valCoordR2(seed, x0, y0), valCoordR2(seed, x1, y0), valCoordR2(seed, x2, y0), valCoordR2(seed, x3, y0), xs),
      cubicLerp(valCoordR2(seed, x0, y1), valCoordR2(seed, x1, y1), valCoordR2(seed, x2, y1), valCoordR2(seed, x3, y1), xs),
      cubicLerp(valCoordR2(seed, x0, y2), valCoordR2(seed, x1, y2), valCoordR2(seed, x2, y2), valCoordR2(seed, x3, y2), xs),
      cubicLerp(valCoordR2(seed, x0, y3), valCoordR2(seed, x1, y3), valCoordR2(seed, x2, y3), valCoordR2(seed, x3, y3), xs),
      ys,
    ) * (1 / (1.5 * 1.5))
  )
}

export function singlePerlinR2(seed: number, x: number, y: number): number {
  let x0 = Math.floor(x)
  let y0 = Math.floor(y)
  const xd0 = x - x0
  const yd0 = y - y0
  const xd1 = xd0 - 1
  const yd1 = yd0 - 1
  const xs = interpQuintic(xd0)
  const ys = interpQuintic(yd0)
  x0 = Math.imul(x0, PRIME_X)
  y0 = Math.imul(y0, PRIME_Y)
  const x1 = x0 + PRIME_X
  const y1 = y0 + PRIME_Y
  const xf0 = lerp(
    gradCoordR2(seed, x0, y0, xd0, yd0),
    gradCoordR2(seed, x1, y0, xd1, yd0),
    xs,
  )
  const xf1 = lerp(
    gradCoordR2(seed, x0, y1, xd0, yd1),
    gradCoordR2(seed, x1, y1, xd1, yd1),
    xs,
  )
  return lerp(xf0, xf1, ys) * 1.4247691104677813
}

export function singleOpenSimplex2R2(seed: number, x: number, y: number): number {
  let i = Math.floor(x)
  let j = Math.floor(y)
  const xi = x - i
  const yi = y - j
  const t = (xi + yi) * G2
  const x0 = xi - t
  const y0 = yi - t
  i = Math.imul(i, PRIME_X)
  j = Math.imul(j, PRIME_Y)
  let n0: number
  let n1: number
  let n2: number
  const a = 0.5 - x0 * x0 - y0 * y0
  n0 = a <= 0 ? 0 : a * a * (a * a) * gradCoordR2(seed, i, j, x0, y0)
  const c = 2 * (1 - 2 * G2) * (1 / G2 - 2) * t + (-2 * (1 - 2 * G2) * (1 - 2 * G2) + a)
  if (c <= 0) {
    n2 = 0
  } else {
    const x2 = x0 + (2 * G2 - 1)
    const y2 = y0 + (2 * G2 - 1)
    n2 = c * c * (c * c) * gradCoordR2(seed, i + PRIME_X, j + PRIME_Y, x2, y2)
  }
  if (y0 > x0) {
    const x1 = x0 + G2
    const y1 = y0 + (G2 - 1)
    const b = 0.5 - x1 * x1 - y1 * y1
    n1 = b <= 0 ? 0 : b * b * (b * b) * gradCoordR2(seed, i, j + PRIME_Y, x1, y1)
  } else {
    const x1 = x0 + (G2 - 1)
    const y1 = y0 + G2
    const b = 0.5 - x1 * x1 - y1 * y1
    n1 = b <= 0 ? 0 : b * b * (b * b) * gradCoordR2(seed, i + PRIME_X, j, x1, y1)
  }
  return (n0 + n1 + n2) * 99.83685446303647
}

export function singleOpenSimplex2SR2(seed: number, x: number, y: number): number {
  let i = Math.floor(x)
  let j = Math.floor(y)
  const xi = x - i
  const yi = y - j
  i = Math.imul(i, PRIME_X)
  j = Math.imul(j, PRIME_Y)
  const i1 = i + PRIME_X
  const j1 = j + PRIME_Y
  const t = (xi + yi) * G2
  const x0 = xi - t
  const y0 = yi - t
  const a0 = 2 / 3 - x0 * x0 - y0 * y0
  let value = a0 * a0 * (a0 * a0) * gradCoordR2(seed, i, j, x0, y0)
  const a1 = 2 * (1 - 2 * G2) * (1 / G2 - 2) * t + (-2 * (1 - 2 * G2) * (1 - 2 * G2) + a0)
  const x1 = x0 - (1 - 2 * G2)
  const y1 = y0 - (1 - 2 * G2)
  value += a1 * a1 * (a1 * a1) * gradCoordR2(seed, i1, j1, x1, y1)
  const xmyi = xi - yi
  if (t > G2) {
    if (xi + xmyi > 1) {
      const x2 = x0 + (3 * G2 - 2)
      const y2 = y0 + (3 * G2 - 1)
      const a2 = 2 / 3 - x2 * x2 - y2 * y2
      if (a2 > 0) value += a2 * a2 * (a2 * a2) * gradCoordR2(seed, i + (PRIME_X << 1), j + PRIME_Y, x2, y2)
    } else {
      const x2 = x0 + G2
      const y2 = y0 + (G2 - 1)
      const a2 = 2 / 3 - x2 * x2 - y2 * y2
      if (a2 > 0) value += a2 * a2 * (a2 * a2) * gradCoordR2(seed, i, j + PRIME_Y, x2, y2)
    }
    if (yi - xmyi > 1) {
      const x3 = x0 + (3 * G2 - 1)
      const y3 = y0 + (3 * G2 - 2)
      const a3 = 2 / 3 - x3 * x3 - y3 * y3
      if (a3 > 0) value += a3 * a3 * (a3 * a3) * gradCoordR2(seed, i + PRIME_X, j + (PRIME_Y << 1), x3, y3)
    } else {
      const x3 = x0 + (G2 - 1)
      const y3 = y0 + G2
      const a3 = 2 / 3 - x3 * x3 - y3 * y3
      if (a3 > 0) value += a3 * a3 * (a3 * a3) * gradCoordR2(seed, i + PRIME_X, j, x3, y3)
    }
  } else {
    if (xi + xmyi < 0) {
      const x2 = x0 + (1 - G2)
      const y2 = y0 - G2
      const a2 = 2 / 3 - x2 * x2 - y2 * y2
      if (a2 > 0) value += a2 * a2 * (a2 * a2) * gradCoordR2(seed, i - PRIME_X, j, x2, y2)
    } else {
      const x2 = x0 + (G2 - 1)
      const y2 = y0 + G2
      const a2 = 2 / 3 - x2 * x2 - y2 * y2
      if (a2 > 0) value += a2 * a2 * (a2 * a2) * gradCoordR2(seed, i + PRIME_X, j, x2, y2)
    }
    if (yi < xmyi) {
      const x2 = x0 - G2
      const y2 = y0 - (G2 - 1)
      const a2 = 2 / 3 - x2 * x2 - y2 * y2
      if (a2 > 0) value += a2 * a2 * (a2 * a2) * gradCoordR2(seed, i, j - PRIME_Y, x2, y2)
    } else {
      const x2 = x0 + G2
      const y2 = y0 + (G2 - 1)
      const a2 = 2 / 3 - x2 * x2 - y2 * y2
      if (a2 > 0) value += a2 * a2 * (a2 * a2) * gradCoordR2(seed, i, j + PRIME_Y, x2, y2)
    }
  }
  return value * 18.24196194486065
}

export function skewOpenSimplex(x: number, y: number): { x: number; y: number } {
  const t = (x + y) * F2
  return { x: x + t, y: y + t }
}

export type CellularDistance = 'euclidean' | 'euclideanSq' | 'manhattan' | 'hybrid'
export type CellularReturn =
  | 'cellValue'
  | 'distance'
  | 'distance2'
  | 'distance2Add'
  | 'distance2Sub'
  | 'distance2Mul'
  | 'distance2Div'

export function parseCellularDistance(value: unknown): CellularDistance {
  const text = typeof value === 'string' ? value.trim() : ''
  const key = text.toLowerCase()
  if (key === 'euclidean') return 'euclidean'
  if (key === 'manhattan') return 'manhattan'
  if (key === 'hybrid') return 'hybrid'
  return 'euclideanSq'
}

export function parseCellularReturn(value: unknown): CellularReturn {
  const text = typeof value === 'string' ? value.trim() : ''
  switch (text.toLowerCase()) {
    case 'cellvalue':
      return 'cellValue'
    case 'distance2':
      return 'distance2'
    case 'distance2add':
      return 'distance2Add'
    case 'distance2sub':
      return 'distance2Sub'
    case 'distance2mul':
      return 'distance2Mul'
    case 'distance2div':
      return 'distance2Div'
    default:
      return 'distance'
  }
}

export function singleCellularR2(
  seed: number,
  x: number,
  y: number,
  jitterMod: number,
  distFn: CellularDistance,
  retType: CellularReturn,
): number {
  const xr = Math.round(x)
  const yr = Math.round(y)
  let distance0 = 1e10
  let distance1 = 1e10
  let closestHash = 0
  const jitter = 0.43701595 * jitterMod
  for (let xi = xr - 1; xi <= xr + 1; xi++) {
    for (let yi = yr - 1; yi <= yr + 1; yi++) {
      const hash = hashR2(seed, Math.imul(xi, PRIME_X), Math.imul(yi, PRIME_Y))
      const idx = (hash & 0xfe) >>> 0
      const vecX = (xi - x) + RAND_VECS_2D[idx]! * jitter
      const vecY = (yi - y) + RAND_VECS_2D[idx | 1]! * jitter
      let dist: number
      if (distFn === 'euclidean') dist = Math.sqrt(vecX * vecX + vecY * vecY)
      else if (distFn === 'manhattan') dist = Math.abs(vecX) + Math.abs(vecY)
      else if (distFn === 'hybrid') dist = Math.abs(vecX) + Math.abs(vecY) + (vecX * vecX + vecY * vecY)
      else dist = vecX * vecX + vecY * vecY
      if (dist < distance0) {
        distance1 = distance0
        distance0 = dist
        closestHash = hash
      } else if (dist < distance1) {
        distance1 = dist
      }
    }
  }
  switch (retType) {
    case 'cellValue': {
      let h = closestHash
      h = Math.imul(h, h)
      h ^= h << 19
      return h * (1 / 2147483648)
    }
    case 'distance2':
      return distance1 - 1
    case 'distance2Add':
      return (distance1 + distance0) * 0.5 - 1
    case 'distance2Sub':
      return distance1 - distance0 - 1
    case 'distance2Mul':
      return distance1 * distance0 * 0.5 - 1
    case 'distance2Div':
      return distance1 > 1e-9 ? distance0 / distance1 - 1 : 0
    default:
      return distance0 - 1
  }
}
