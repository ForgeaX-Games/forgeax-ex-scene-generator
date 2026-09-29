import { GRADIENTS_2D } from './tables.ts'

export const PRIME_X = 501125321
export const PRIME_Y = 1136930381
export const SQRT3 = 1.7320508075688772935274463415059
export const G2 = (3 - SQRT3) / 6
export const F2 = 0.5 * (SQRT3 - 1)
export const PING_PONG_STRENGTH = 2

export function hashR2(seed: number, xPrimed: number, yPrimed: number): number {
  let h = seed ^ xPrimed ^ yPrimed
  h = Math.imul(h, 0x27d4eb2d)
  return h
}

export function valCoordR2(seed: number, xPrimed: number, yPrimed: number): number {
  let hash = hashR2(seed, xPrimed, yPrimed)
  hash = Math.imul(hash, hash)
  hash ^= hash << 19
  return hash * (1 / 2147483648)
}

export function gradCoordR2(
  seed: number,
  xPrimed: number,
  yPrimed: number,
  xd: number,
  yd: number,
): number {
  let h = hashR2(seed, xPrimed, yPrimed)
  h ^= h >> 15
  h &= 127 << 1
  return xd * GRADIENTS_2D[h]! + yd * GRADIENTS_2D[h | 1]!
}

export function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a)
}

export function cubicLerp(a: number, b: number, c: number, d: number, t: number): number {
  const p = d - c - (a - b)
  return t * t * t * p + t * t * (a - b - p) + t * (c - a) + b
}

export function interpHermite(t: number): number {
  return t * t * (3 - 2 * t)
}

export function interpQuintic(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export function pingPong(t: number): number {
  t -= Math.trunc(t * 0.5) * 2
  return t < 1 ? t : 2 - t
}

export function calcFractalBounding(octaves: number, gain: number): number {
  let g = Math.abs(gain)
  let amp = g
  let ampFractal = 1
  for (let i = 1; i < octaves; i++) {
    ampFractal += amp
    amp *= g
  }
  return 1 / ampFractal
}

export type SampleFn = (seed: number, x: number, y: number) => number

export function sampleFractal(
  sample: SampleFn,
  fractal: 'none' | 'fbm' | 'ridged' | 'pingpong',
  seed: number,
  x: number,
  y: number,
  octaves: number,
  lacunarity: number,
  gain: number,
): number {
  if (fractal === 'none') return sample(seed, x, y)
  const bounding = calcFractalBounding(octaves, gain)
  let s = seed
  let sum = 0
  let amp = bounding
  let cx = x
  let cy = y
  for (let i = 0; i < octaves; i++) {
    const raw = sample(s++, cx, cy)
    if (fractal === 'ridged') {
      const noise = Math.abs(raw)
      sum += (noise * -2 + 1) * amp
      amp *= lerp(1, 1 - noise, 0)
    } else if (fractal === 'pingpong') {
      const noise = pingPong((raw + 1) * PING_PONG_STRENGTH)
      sum += (noise - 0.5) * 2 * amp
      amp *= lerp(1, noise, 0)
    } else {
      sum += raw * amp
      amp *= lerp(1, Math.min(raw + 1, 2) * 0.5, 0)
    }
    cx *= lacunarity
    cy *= lacunarity
    amp *= gain
  }
  return sum
}
