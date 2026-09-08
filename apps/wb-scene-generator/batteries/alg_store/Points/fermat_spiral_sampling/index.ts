/**
 * 费马螺旋采样 (fermat_spiral_sampling)
 * Distributes points using the golden angle on a Fermat spiral,
 * producing a sunflower-like uniform pattern within a circular region.
 * Self-contained — no external imports.
 */

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

class LCG {
  private s: bigint;
  constructor(seed: number) {
    this.s = BigInt(seed > 0 ? seed : 48271);
  }
  next(): bigint {
    this.s =
      (this.s * 6364136223846793005n + 1442695040888963407n) &
      0xffffffffffffffffn;
    return this.s;
  }
  float01(): number {
    return Number((this.next() >> 33n) % 1000000n) / 1000000;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function generateFermatSpiral(
  n: number,
  radius: number,
  cx: number,
  cy: number,
  jitter: number,
  rng: LCG,
): { fx: number; fy: number }[] {
  const result: { fx: number; fy: number }[] = [];
  if (n <= 0) return result;

  const scale = n > 1 ? radius / Math.sqrt(n - 1) : 0;

  for (let i = 0; i < n; i++) {
    const theta = i * GOLDEN_ANGLE;
    const r = scale * Math.sqrt(i);
    let px = cx + r * Math.cos(theta);
    let py = cy + r * Math.sin(theta);

    if (jitter > 0) {
      px += (rng.float01() - 0.5) * 2 * jitter;
      py += (rng.float01() - 0.5) * 2 * jitter;
    }

    result.push({ fx: px, fy: py });
  }

  return result;
}

export function fermatSpiralSampling(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const width = clamp(Math.floor(Number(input.width) || 64), 4, 512);
  const height = clamp(Math.floor(Number(input.height) || 64), 4, 512);
  const numPoints = clamp(Math.floor(Number(input.numPoints) || 200), 1, 10000);
  const jitter = clamp(Number(input.jitter) ?? 0, 0, 10);
  const seed = Math.floor(Number(input.seed) || 0);

  const rng = new LCG(seed);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 2 - 1;

  const rawPoints = generateFermatSpiral(
    numPoints,
    radius,
    cx,
    cy,
    jitter,
    rng,
  );

  const grid: number[][] = Array.from({ length: height }, () =>
    new Array(width).fill(0),
  );

  const points: number[][] = [];
  for (const p of rawPoints) {
    const px = Math.floor(p.fx);
    const py = Math.floor(p.fy);
    if (px >= 0 && px < width && py >= 0 && py < height && grid[py][px] === 0) {
      grid[py][px] = 1;
      points.push([px, py]);
    }
  }

  return { grid, points, count: points.length };
}
