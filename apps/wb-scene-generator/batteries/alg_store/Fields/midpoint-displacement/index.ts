/**
 * 中点位移地形 (Midpoint Displacement Terrain Generator)
 * Generates a fractal heightmap using the 2D midpoint displacement algorithm.
 * Grid size is always (2^power + 1) × (2^power + 1).
 * Self-contained — no external imports.
 *
 * Unlike Diamond-Square, edge midpoints are computed from only 2 endpoints,
 * producing slightly different visual characteristics with more pronounced
 * axis-aligned features.
 */

export interface MidpointDisplacementInput {
  power?: number;
  roughness?: number;
  initHeight?: number;
  spread?: number;
  seed?: number;
}

export interface MidpointDisplacementOutput {
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

export function generateMidpointDisplacement(
  input: MidpointDisplacementInput,
): MidpointDisplacementOutput {
  const power = Math.max(2, Math.min(10, Math.floor(input.power ?? 7)));
  const size = (1 << power) + 1;
  const roughness = Math.max(0, Math.min(1, input.roughness ?? 0.5));
  const initHeight = input.initHeight ?? 0.5;
  const spread = input.spread ?? 1.0;
  const rng = new LCG(input.seed ?? 0);

  const grid: number[][] = Array.from({ length: size }, () =>
    new Array(size).fill(0),
  );

  grid[0][0] = initHeight;
  grid[0][size - 1] = initHeight;
  grid[size - 1][0] = initHeight;
  grid[size - 1][size - 1] = initHeight;

  let step = size - 1;
  let scale = spread;

  while (step > 1) {
    const half = step >> 1;

    // ── Edge midpoints (horizontal) ──
    // Midpoint of each horizontal edge = average of 2 endpoints + random
    for (let y = 0; y < size; y += step) {
      for (let x = 0; x < size - 1; x += step) {
        grid[y][x + half] =
          (grid[y][x] + grid[y][x + step]) * 0.5 + rng.float() * scale;
      }
    }

    // ── Edge midpoints (vertical) ──
    // Midpoint of each vertical edge = average of 2 endpoints + random
    for (let y = 0; y < size - 1; y += step) {
      for (let x = 0; x < size; x += step) {
        grid[y + half][x] =
          (grid[y][x] + grid[y + step][x]) * 0.5 + rng.float() * scale;
      }
    }

    // ── Center points ──
    // Center = average of 4 surrounding edge midpoints + random
    for (let y = 0; y < size - 1; y += step) {
      for (let x = 0; x < size - 1; x += step) {
        const top = grid[y][x + half];
        const bottom = grid[y + step][x + half];
        const left = grid[y + half][x];
        const right = grid[y + half][x + step];
        grid[y + half][x + half] =
          (top + bottom + left + right) * 0.25 + rng.float() * scale;
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
