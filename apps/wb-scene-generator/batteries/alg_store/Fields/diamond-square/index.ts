/**
 * Diamond-Square Terrain Generator
 * Generates a fractal heightmap using the diamond-square (midpoint displacement) algorithm.
 * Grid size is always (2^power + 1) × (2^power + 1).
 * Self-contained — no external imports.
 */

export interface DiamondSquareInput {
  power?: number;
  roughness?: number;
  initHeight?: number;
  spread?: number;
  seed?: number;
}

export interface DiamondSquareOutput {
  grid: number[][];
}

class LCG {
  private s: bigint;
  constructor(seed: number) {
    const intSeed = Number.isFinite(seed) ? Math.floor(seed) : 0;
    this.s = BigInt(intSeed > 0 ? intSeed : 48271);
  }
  next(): bigint {
    this.s =
      (this.s * 6364136223846793005n + 1442695040888963407n) &
      0xffffffffffffffffn;
    return this.s;
  }
  /** Returns a float in [-1, 1) using high bits */
  float(): number {
    return Number((this.next() >> 33n) % 1000000n) / 500000 - 1;
  }
}

export function generateDiamondSquare(input: DiamondSquareInput): DiamondSquareOutput {
  const power = Math.max(2, Math.min(10, Math.floor(input.power ?? 7)));
  const size = (1 << power) + 1;
  const roughness = Math.max(0, Math.min(1, input.roughness ?? 0.5));
  const initHeight = input.initHeight ?? 0.5;
  const spread = input.spread ?? 1.0;
  const rng = new LCG(input.seed ?? 0);

  const grid: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));

  // Seed corners
  grid[0][0] = initHeight;
  grid[0][size - 1] = initHeight;
  grid[size - 1][0] = initHeight;
  grid[size - 1][size - 1] = initHeight;

  let step = size - 1;
  let scale = spread;

  while (step > 1) {
    const half = step >> 1;

    // ── Diamond step ──
    // For each square, set the center to the average of corners + random offset
    for (let y = 0; y < size - 1; y += step) {
      for (let x = 0; x < size - 1; x += step) {
        const avg =
          (grid[y][x] +
            grid[y][x + step] +
            grid[y + step][x] +
            grid[y + step][x + step]) *
          0.25;
        grid[y + half][x + half] = avg + rng.float() * scale;
      }
    }

    // ── Square step ──
    // For each diamond, set the midpoint of each edge to the average of
    // its orthogonal neighbors + random offset
    for (let y = 0; y < size; y += half) {
      // Offset x start on alternating rows so we hit the right diamonds
      const xStart = (y + half) % step === 0 ? 0 : half;
      for (let x = xStart; x < size; x += step) {
        let sum = 0;
        let count = 0;
        if (y >= half) { sum += grid[y - half][x]; count++; }
        if (y + half < size) { sum += grid[y + half][x]; count++; }
        if (x >= half) { sum += grid[y][x - half]; count++; }
        if (x + half < size) { sum += grid[y][x + half]; count++; }
        grid[y][x] = sum / count + rng.float() * scale;
      }
    }

    scale *= Math.pow(2, -roughness);
    step = half;
  }

  // Normalize to 0~1
  let minVal = Infinity;
  let maxVal = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = grid[y][x];
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    }
  }

  const range = maxVal - minVal;
  if (range > 0) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        grid[y][x] = (grid[y][x] - minVal) / range;
      }
    }
  }

  return { grid };
}
