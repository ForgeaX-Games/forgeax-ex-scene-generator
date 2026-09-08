/**
 * Value Cubic Noise Generator
 * Based on FastNoiseLite (MIT License, Jordan Peck 2023).
 * Uses cubic interpolation over 4×4 lattice points for smoother results than basic Value noise.
 * Supports single-layer and fractal (FBm / Ridged / PingPong) modes.
 * Self-contained — no external imports.
 */

export interface ValueCubicNoiseInput {
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

export interface ValueCubicNoiseOutput {
  grid: number[][];
}

const PRIME_X = 501125321;
const PRIME_Y = 1136930381;

function hashR2(seed: number, xPrimed: number, yPrimed: number): number {
  let h = seed ^ xPrimed ^ yPrimed;
  h = Math.imul(h, 0x27d4eb2d);
  return h;
}

function valCoordR2(seed: number, xPrimed: number, yPrimed: number): number {
  let hash = hashR2(seed, xPrimed, yPrimed);
  hash = Math.imul(hash, hash);
  hash ^= hash << 19;
  return hash * (1 / 2147483648.0);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function cubicLerp(a: number, b: number, c: number, d: number, t: number): number {
  const p = d - c - (a - b);
  return t * t * t * p + t * t * (a - b - p) + t * (c - a) + b;
}

function singleValueCubicR2(seed: number, x: number, y: number): number {
  let x1 = Math.floor(x);
  let y1 = Math.floor(y);
  const xs = x - x1;
  const ys = y - y1;

  x1 = Math.imul(x1, PRIME_X);
  y1 = Math.imul(y1, PRIME_Y);
  const x0 = x1 - PRIME_X;
  const y0 = y1 - PRIME_Y;
  const x2 = x1 + PRIME_X;
  const y2 = y1 + PRIME_Y;
  const x3 = x1 + (PRIME_X << 1);
  const y3 = y1 + (PRIME_Y << 1);

  return (
    cubicLerp(
      cubicLerp(valCoordR2(seed, x0, y0), valCoordR2(seed, x1, y0), valCoordR2(seed, x2, y0), valCoordR2(seed, x3, y0), xs),
      cubicLerp(valCoordR2(seed, x0, y1), valCoordR2(seed, x1, y1), valCoordR2(seed, x2, y1), valCoordR2(seed, x3, y1), xs),
      cubicLerp(valCoordR2(seed, x0, y2), valCoordR2(seed, x1, y2), valCoordR2(seed, x2, y2), valCoordR2(seed, x3, y2), xs),
      cubicLerp(valCoordR2(seed, x0, y3), valCoordR2(seed, x1, y3), valCoordR2(seed, x2, y3), valCoordR2(seed, x3, y3), xs),
      ys
    ) * (1 / (1.5 * 1.5))
  );
}

function pingPong(t: number): number {
  t -= Math.trunc(t * 0.5) * 2;
  return t < 1 ? t : 2 - t;
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
    const noise = singleValueCubicR2(s++, cx, cy);
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
    const noise = Math.abs(singleValueCubicR2(s++, cx, cy));
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
      (singleValueCubicR2(s++, cx, cy) + 1) * pingPongStrength,
    );
    sum += (noise - 0.5) * 2 * amp;
    amp *= lerp(1.0, noise, 0.0);
    cx *= lacunarity;
    cy *= lacunarity;
    amp *= gain;
  }
  return sum;
}

export function generateValueCubicNoise(input: ValueCubicNoiseInput): ValueCubicNoiseOutput {
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
      const sx = (x + ox) * frequency;
      const sy = (y + oy) * frequency;

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
          raw = singleValueCubicR2(seed, sx, sy);
          break;
      }

      grid[y]![x] = raw * 0.5 + 0.5;
    }
  }

  return { grid };
}
