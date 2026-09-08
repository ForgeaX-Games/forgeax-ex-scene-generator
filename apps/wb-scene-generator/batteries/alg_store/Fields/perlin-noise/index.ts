/**
 * Perlin Noise Generator
 * Based on FastNoiseLite (MIT License, Jordan Peck 2023).
 * Supports single-layer and fractal (FBm / Ridged / PingPong) modes.
 * Self-contained — no external imports.
 */

export interface PerlinNoiseInput {
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

export interface PerlinNoiseOutput {
  grid: number[][];
}

// ── Gradient table (from FastNoiseLite) ─────────────────────────────────
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

function interpQuintic(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function pingPong(t: number): number {
  t -= Math.trunc(t * 0.5) * 2;
  return t < 1 ? t : 2 - t;
}

function singlePerlinR2(seed: number, x: number, y: number): number {
  let x0 = Math.floor(x);
  let y0 = Math.floor(y);

  const xd0 = x - x0;
  const yd0 = y - y0;
  const xd1 = xd0 - 1;
  const yd1 = yd0 - 1;

  const xs = interpQuintic(xd0);
  const ys = interpQuintic(yd0);

  x0 = Math.imul(x0, PRIME_X);
  y0 = Math.imul(y0, PRIME_Y);
  const x1 = x0 + PRIME_X;
  const y1 = y0 + PRIME_Y;

  const xf0 = lerp(
    gradCoordR2(seed, x0, y0, xd0, yd0),
    gradCoordR2(seed, x1, y0, xd1, yd0),
    xs,
  );
  const xf1 = lerp(
    gradCoordR2(seed, x0, y1, xd0, yd1),
    gradCoordR2(seed, x1, y1, xd1, yd1),
    xs,
  );

  return lerp(xf0, xf1, ys) * 1.4247691104677813;
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
    const noise = singlePerlinR2(s++, cx, cy);
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
    const noise = Math.abs(singlePerlinR2(s++, cx, cy));
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
      (singlePerlinR2(s++, cx, cy) + 1) * pingPongStrength,
    );
    sum += (noise - 0.5) * 2 * amp;
    amp *= lerp(1.0, noise, 0.0);
    cx *= lacunarity;
    cy *= lacunarity;
    amp *= gain;
  }
  return sum;
}

export function generatePerlinNoise(input: PerlinNoiseInput): PerlinNoiseOutput {
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
          raw = singlePerlinR2(seed, sx, sy);
          break;
      }

      grid[y][x] = raw * 0.5 + 0.5;
    }
  }

  return { grid };
}
