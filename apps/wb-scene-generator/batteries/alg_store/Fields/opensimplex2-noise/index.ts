/**
 * OpenSimplex2 Noise Generator
 * Based on FastNoiseLite (MIT License, Jordan Peck 2023).
 * Supports single-layer and fractal (FBm / Ridged / PingPong) modes.
 * Self-contained — no external imports.
 */

export interface OpenSimplex2NoiseInput {
  width?: number;
  height?: number;
  frequency?: number;
  fractalType?: string;
  octaves?: number;
  lacunarity?: number;
  gain?: number;
  offsetX?: number;
  offsetY?: number;
  seed?: number;
}

export interface OpenSimplex2NoiseOutput {
  grid: number[][];
}

// prettier-ignore
const GRADIENTS_2D = [
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.130526192220052, 0.99144486137381, 0.38268343236509, 0.923879532511287, 0.608761429008721, 0.793353340291235, 0.793353340291235, 0.608761429008721,
  0.923879532511287, 0.38268343236509, 0.99144486137381, 0.130526192220051, 0.99144486137381, -0.130526192220051, 0.923879532511287, -0.38268343236509,
  0.793353340291235, -0.60876142900872, 0.608761429008721, -0.793353340291235, 0.38268343236509, -0.923879532511287, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.38268343236509, -0.923879532511287, -0.608761429008721, -0.793353340291235, -0.793353340291235, -0.608761429008721,
  -0.923879532511287, -0.38268343236509, -0.99144486137381, -0.130526192220052, -0.99144486137381, 0.130526192220051, -0.923879532511287, 0.38268343236509,
  -0.793353340291235, 0.608761429008721, -0.608761429008721, 0.793353340291235, -0.38268343236509, 0.923879532511287, -0.130526192220052, 0.99144486137381,
  0.38268343236509, 0.923879532511287, 0.923879532511287, 0.38268343236509, 0.923879532511287, -0.38268343236509, 0.38268343236509, -0.923879532511287,
  -0.38268343236509, -0.923879532511287, -0.923879532511287, -0.38268343236509, -0.923879532511287, 0.38268343236509, -0.38268343236509, 0.923879532511287,
];

const PRIME_X = 501125321;
const PRIME_Y = 1136930381;
const SQRT3 = 1.7320508075688772935274463415059;
const G2 = (3 - SQRT3) / 6;
const F2 = 0.5 * (SQRT3 - 1);

function hashR2(seed: number, xPrimed: number, yPrimed: number): number {
  let h = seed ^ xPrimed ^ yPrimed;
  h = Math.imul(h, 0x27d4eb2d);
  return h;
}

function gradCoordR2(
  seed: number, xPrimed: number, yPrimed: number, xd: number, yd: number,
): number {
  let h = hashR2(seed, xPrimed, yPrimed);
  h ^= h >> 15;
  h &= 127 << 1;
  return xd * GRADIENTS_2D[h]! + yd * GRADIENTS_2D[h | 1]!;
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function pingPong(t: number): number {
  t -= Math.trunc(t * 0.5) * 2;
  return t < 1 ? t : 2 - t;
}

function singleOpenSimplex2R2(seed: number, x: number, y: number): number {
  let i = Math.floor(x);
  let j = Math.floor(y);
  const xi = x - i;
  const yi = y - j;

  const t = (xi + yi) * G2;
  const x0 = xi - t;
  const y0 = yi - t;

  i = Math.imul(i, PRIME_X);
  j = Math.imul(j, PRIME_Y);

  let n0: number;
  let n1: number;
  let n2: number;

  const a = 0.5 - x0 * x0 - y0 * y0;
  if (a <= 0) {
    n0 = 0;
  } else {
    n0 = a * a * (a * a) * gradCoordR2(seed, i, j, x0, y0);
  }

  const c =
    2 * (1 - 2 * G2) * (1 / G2 - 2) * t +
    (-2 * (1 - 2 * G2) * (1 - 2 * G2) + a);
  if (c <= 0) {
    n2 = 0;
  } else {
    const x2 = x0 + (2 * G2 - 1);
    const y2 = y0 + (2 * G2 - 1);
    n2 = c * c * (c * c) * gradCoordR2(seed, i + PRIME_X, j + PRIME_Y, x2, y2);
  }

  if (y0 > x0) {
    const x1 = x0 + G2;
    const y1 = y0 + (G2 - 1);
    const b = 0.5 - x1 * x1 - y1 * y1;
    if (b <= 0) {
      n1 = 0;
    } else {
      n1 = b * b * (b * b) * gradCoordR2(seed, i, j + PRIME_Y, x1, y1);
    }
  } else {
    const x1 = x0 + (G2 - 1);
    const y1 = y0 + G2;
    const b = 0.5 - x1 * x1 - y1 * y1;
    if (b <= 0) {
      n1 = 0;
    } else {
      n1 = b * b * (b * b) * gradCoordR2(seed, i + PRIME_X, j, x1, y1);
    }
  }

  return (n0 + n1 + n2) * 99.83685446303647;
}

function calcFractalBounding(octaves: number, gain: number): number {
  let g = Math.abs(gain);
  let amp = g;
  let ampFractal = 1.0;
  for (let i = 1; i < octaves; i++) {
    ampFractal += amp;
    amp *= g;
  }
  return 1 / ampFractal;
}

function fractalFBm(
  seed: number, x: number, y: number,
  octaves: number, lacunarity: number, gain: number, bounding: number,
): number {
  let s = seed;
  let sum = 0;
  let amp = bounding;
  let cx = x;
  let cy = y;

  for (let i = 0; i < octaves; i++) {
    const noise = singleOpenSimplex2R2(s++, cx, cy);
    sum += noise * amp;
    amp *= lerp(1.0, Math.min(noise + 1, 2) * 0.5, 0.0);
    cx *= lacunarity;
    cy *= lacunarity;
    amp *= gain;
  }
  return sum;
}

function fractalRidged(
  seed: number, x: number, y: number,
  octaves: number, lacunarity: number, gain: number, bounding: number,
): number {
  let s = seed;
  let sum = 0;
  let amp = bounding;
  let cx = x;
  let cy = y;

  for (let i = 0; i < octaves; i++) {
    const noise = Math.abs(singleOpenSimplex2R2(s++, cx, cy));
    sum += (noise * -2 + 1) * amp;
    amp *= lerp(1.0, 1 - noise, 0.0);
    cx *= lacunarity;
    cy *= lacunarity;
    amp *= gain;
  }
  return sum;
}

function fractalPingPong(
  seed: number, x: number, y: number,
  octaves: number, lacunarity: number, gain: number, bounding: number,
  pingPongStrength: number,
): number {
  let s = seed;
  let sum = 0;
  let amp = bounding;
  let cx = x;
  let cy = y;

  for (let i = 0; i < octaves; i++) {
    const noise = pingPong(
      (singleOpenSimplex2R2(s++, cx, cy) + 1) * pingPongStrength,
    );
    sum += (noise - 0.5) * 2 * amp;
    amp *= lerp(1.0, noise, 0.0);
    cx *= lacunarity;
    cy *= lacunarity;
    amp *= gain;
  }
  return sum;
}

export function generateOpenSimplex2Noise(input: OpenSimplex2NoiseInput): OpenSimplex2NoiseOutput {
  const w = Math.max(1, Math.min(1024, Math.floor(input.width ?? 128)));
  const h = Math.max(1, Math.min(1024, Math.floor(input.height ?? 128)));
  const frequency = input.frequency ?? 0.02;
  const fractalType = input.fractalType ?? "FBm";
  const octaves = Math.max(1, Math.min(8, Math.floor(input.octaves ?? 4)));
  const lacunarity = input.lacunarity ?? 2.0;
  const gain = input.gain ?? 0.5;
  const ox = input.offsetX ?? 0;
  const oy = input.offsetY ?? 0;
  const seed = Math.floor(input.seed ?? 1337);

  const bounding = calcFractalBounding(octaves, gain);

  const grid: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sx = (x + ox) * frequency;
      let sy = (y + oy) * frequency;

      const t = (sx + sy) * F2;
      sx += t;
      sy += t;

      let raw: number;
      switch (fractalType) {
        case "FBm":
          raw = fractalFBm(seed, sx, sy, octaves, lacunarity, gain, bounding);
          break;
        case "Ridged":
          raw = fractalRidged(seed, sx, sy, octaves, lacunarity, gain, bounding);
          break;
        case "PingPong":
          raw = fractalPingPong(seed, sx, sy, octaves, lacunarity, gain, bounding, 2.0);
          break;
        default:
          raw = singleOpenSimplex2R2(seed, sx, sy);
          break;
      }

      grid[y][x] = raw * 0.5 + 0.5;
    }
  }

  return { grid };
}
