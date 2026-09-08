/**
 * reaction_diffusion
 * Gray-Scott 反应扩散模型：
 *   ∂A/∂t = D_A ∇²A − A B² + F (1 − A)
 *   ∂B/∂t = D_B ∇²B + A B² − (K + F) B
 * 用 5 点拉普拉斯格子近似，周期边界。
 */

type Grid = number[][];

class LCG {
  private s: number;
  constructor(seed: number) { this.s = seed > 0 ? seed : 48271; }
  next(): number { this.s = (this.s * 1103515245 + 12345) & 0x7fffffff; return this.s; }
  rand(): number { return this.next() / 0x80000000; }
}

const PRESETS: Record<string, { F: number; K: number }> = {
  spots: { F: 0.035, K: 0.065 },
  stripes: { F: 0.022, K: 0.051 },
  maze: { F: 0.029, K: 0.057 },
  coral: { F: 0.060, K: 0.062 },
  mitosis: { F: 0.0367, K: 0.0649 },
  worms: { F: 0.046, K: 0.063 },
};

export function reactionDiffusion(input: Record<string, unknown>): Record<string, unknown> {
  const w = Math.max(16, Math.min(512, Math.floor(typeof input.width === "number" ? input.width : 128)));
  const h = Math.max(16, Math.min(512, Math.floor(typeof input.height === "number" ? input.height : 128)));
  const iterations = Math.max(100, Math.min(50000, Math.floor(typeof input.iterations === "number" ? input.iterations : 5000)));
  const dA = typeof input.diffuseA === "number" ? input.diffuseA : 1.0;
  const dB = typeof input.diffuseB === "number" ? input.diffuseB : 0.5;
  const dt = typeof input.dt === "number" ? input.dt : 1.0;
  const preset = typeof input.preset === "string" ? input.preset : "spots";
  let F = typeof input.feedRate === "number" ? input.feedRate : 0.055;
  let K = typeof input.killRate === "number" ? input.killRate : 0.062;
  if (preset !== "custom" && PRESETS[preset]) {
    F = PRESETS[preset].F;
    K = PRESETS[preset].K;
  }
  const seedDensity = Math.max(0, Math.min(1, typeof input.seedDensity === "number" ? input.seedDensity : 0.05));
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? (Date.now() & 0x7fffffff) : seedRaw;
  const rng = new LCG(seed);

  const total = w * h;
  let A = new Float64Array(total).fill(1);
  let B = new Float64Array(total).fill(0);
  let nextA = new Float64Array(total);
  let nextB = new Float64Array(total);

  const cx = w / 2, cy = h / 2;
  const r = Math.max(2, Math.min(w, h) * 0.08);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy < r * r) B[y * w + x] = 1;
    }
  }
  for (let i = 0; i < total; i++) {
    if (rng.rand() < seedDensity) B[i] = 1;
  }

  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < h; y++) {
      const yp = (y - 1 + h) % h;
      const yn = (y + 1) % h;
      for (let x = 0; x < w; x++) {
        const xp = (x - 1 + w) % w;
        const xn = (x + 1) % w;
        const idx = y * w + x;
        const a = A[idx];
        const b = B[idx];
        const lapA =
          A[y * w + xp] + A[y * w + xn] +
          A[yp * w + x] + A[yn * w + x] -
          4 * a;
        const lapB =
          B[y * w + xp] + B[y * w + xn] +
          B[yp * w + x] + B[yn * w + x] -
          4 * b;
        const reaction = a * b * b;
        nextA[idx] = a + dt * (dA * lapA - reaction + F * (1 - a));
        nextB[idx] = b + dt * (dB * lapB + reaction - (K + F) * b);
        if (nextA[idx] < 0) nextA[idx] = 0; else if (nextA[idx] > 1) nextA[idx] = 1;
        if (nextB[idx] < 0) nextB[idx] = 0; else if (nextB[idx] > 1) nextB[idx] = 1;
      }
    }
    const tmpA = A; A = nextA; nextA = tmpA;
    const tmpB = B; B = nextB; nextB = tmpB;
  }

  const gridA: Grid = new Array(h);
  const gridB: Grid = new Array(h);
  const maskGrid: Grid = new Array(h);
  for (let y = 0; y < h; y++) {
    gridA[y] = new Array(w);
    gridB[y] = new Array(w);
    maskGrid[y] = new Array(w);
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      gridA[y][x] = Math.round(A[idx] * 10000) / 10000;
      gridB[y][x] = Math.round(B[idx] * 10000) / 10000;
      maskGrid[y][x] = B[idx] > 0.3 ? 1 : 0;
    }
  }

  return { gridB, gridA, maskGrid };
}
