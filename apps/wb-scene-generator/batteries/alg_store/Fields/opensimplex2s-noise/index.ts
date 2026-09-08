/**
 * OpenSimplex2S Noise Generator
 * Based on FastNoiseLite (MIT License, Jordan Peck 2023).
 * Smoother variant of OpenSimplex2 — higher quality, slightly slower.
 * Supports single-layer and fractal (FBm / Ridged / PingPong) modes.
 * Self-contained — no external imports.
 */

export interface OpenSimplex2SNoiseInput {
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

export interface OpenSimplex2SNoiseOutput {
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

const SQRT3 = 1.7320508075688772935274463415059;
const G2 = (3 - SQRT3) / 6;

function singleOpenSimplex2SR2(seed: number, x: number, y: number): number {
  let i = Math.floor(x);
  let j = Math.floor(y);
  let xi = x - i;
  let yi = y - j;

  i = Math.imul(i, PRIME_X);
  j = Math.imul(j, PRIME_Y);
  let i1 = i + PRIME_X;
  let j1 = j + PRIME_Y;

  let t = (xi + yi) * G2;
  let x0 = xi - t;
  let y0 = yi - t;

  let a0 = 2.0 / 3.0 - x0 * x0 - y0 * y0;
  let value = a0 * a0 * (a0 * a0) * gradCoordR2(seed, i, j, x0, y0);
  let a1 = 2 * (1 - 2 * G2) * (1 / G2 - 2) * t + (-2 * (1 - 2 * G2) * (1 - 2 * G2) + a0);
  let x1 = x0 - (1 - 2 * G2);
  let y1 = y0 - (1 - 2 * G2);
  value += a1 * a1 * (a1 * a1) * gradCoordR2(seed, i1, j1, x1, y1);

  let xmyi = xi - yi;
  if (t > G2) {
    if (xi + xmyi > 1) {
      let x2 = x0 + (3 * G2 - 2);
      let y2 = y0 + (3 * G2 - 1);
      let a2 = 2.0 / 3.0 - x2 * x2 - y2 * y2;
      if (a2 > 0) {
        value += a2 * a2 * (a2 * a2) * gradCoordR2(seed, i + (PRIME_X << 1), j + PRIME_Y, x2, y2);
      }
    } else {
      let x2 = x0 + G2;
      let y2 = y0 + (G2 - 1);
      let a2 = 2.0 / 3.0 - x2 * x2 - y2 * y2;
      if (a2 > 0) {
        value += a2 * a2 * (a2 * a2) * gradCoordR2(seed, i, j + PRIME_Y, x2, y2);
      }
    }
    if (yi - xmyi > 1) {
      let x3 = x0 + (3 * G2 - 1);
      let y3 = y0 + (3 * G2 - 2);
      let a3 = 2.0 / 3.0 - x3 * x3 - y3 * y3;
      if (a3 > 0) {
        value += a3 * a3 * (a3 * a3) * gradCoordR2(seed, i + PRIME_X, j + (PRIME_Y << 1), x3, y3);
      }
    } else {
      let x3 = x0 + (G2 - 1);
      let y3 = y0 + G2;
      let a3 = 2.0 / 3.0 - x3 * x3 - y3 * y3;
      if (a3 > 0) {
        value += a3 * a3 * (a3 * a3) * gradCoordR2(seed, i + PRIME_X, j, x3, y3);
      }
    }
  } else {
    if (xi + xmyi < 0) {
      let x2 = x0 + (1 - G2);
      let y2 = y0 - G2;
      let a2 = 2.0 / 3.0 - x2 * x2 - y2 * y2;
      if (a2 > 0) {
        value += a2 * a2 * (a2 * a2) * gradCoordR2(seed, i - PRIME_X, j, x2, y2);
      }
    } else {
      let x2 = x0 + (G2 - 1);
      let y2 = y0 + G2;
      let a2 = 2.0 / 3.0 - x2 * x2 - y2 * y2;
      if (a2 > 0) {
        value += a2 * a2 * (a2 * a2) * gradCoordR2(seed, i + PRIME_X, j, x2, y2);
      }
    }
    if (yi < xmyi) {
      let x2 = x0 - G2;
      let y2 = y0 - (G2 - 1);
      let a2 = 2.0 / 3.0 - x2 * x2 - y2 * y2;
      if (a2 > 0) {
        value += a2 * a2 * (a2 * a2) * gradCoordR2(seed, i, j - PRIME_Y, x2, y2);
      }
    } else {
      let x2 = x0 + G2;
      let y2 = y0 + (G2 - 1);
      let a2 = 2.0 / 3.0 - x2 * x2 - y2 * y2;
      if (a2 > 0) {
        value += a2 * a2 * (a2 * a2) * gradCoordR2(seed, i, j + PRIME_Y, x2, y2);
      }
    }
  }
  return value * 18.24196194486065;
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
    const noise = singleOpenSimplex2SR2(s++, cx, cy);
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
    const noise = Math.abs(singleOpenSimplex2SR2(s++, cx, cy));
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
      (singleOpenSimplex2SR2(s++, cx, cy) + 1) * pingPongStrength,
    );
    sum += (noise - 0.5) * 2 * amp;
    amp *= lerp(1.0, noise, 0.0);
    cx *= lacunarity;
    cy *= lacunarity;
    amp *= gain;
  }
  return sum;
}

const F2 = 0.5 * (SQRT3 - 1);

export function generateOpenSimplex2SNoise(input: OpenSimplex2SNoiseInput): OpenSimplex2SNoiseOutput {
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
          raw = singleOpenSimplex2SR2(seed, sx, sy);
          break;
      }

      grid[y]![x] = raw * 0.5 + 0.5;
    }
  }

  return { grid };
}
