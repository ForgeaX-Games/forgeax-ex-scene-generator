/**
 * Diffusion-Limited Aggregation (DLA)
 *
 * Particles perform random walks within a grid mask and aggregate upon
 * contact with the existing cluster, producing fractal branching patterns
 * reminiscent of coral, lightning, mineral dendrites, and frost crystals.
 *
 * Algorithm:
 *   1. Place seed cell(s) to initialise the cluster
 *   2. For each particle:
 *      a. Launch from a random position within a shell around the cluster
 *      b. Random-walk (with optional directional bias)
 *      c. When a neighbouring cell belongs to the cluster, stick with
 *         probability `stickiness`
 *      d. Low stickiness → particles bounce & explore → denser structures
 *         High stickiness → immediate adhesion → sparse dendrites
 *   3. Output binary grid: cluster = 1, empty = 0
 *
 * Performance: bbox-based launch/kill zones keep walk lengths short even
 * on large grids.  Flat Uint8Array for O(1) cluster/mask lookups.
 *
 * Self-contained — no external imports.
 */

class LCG {
  private s: bigint;
  constructor(seed: number) {
    this.s = BigInt(seed > 0 ? seed : 77713);
  }
  next(): bigint {
    this.s =
      (this.s * 6364136223846793005n + 1442695040888963407n) &
      0xffffffffffffffffn;
    return this.s;
  }
  intn(n: number): number {
    if (n <= 0) return 0;
    return Number((this.next() >> 33n) % BigInt(n));
  }
  float01(): number {
    return Number((this.next() >> 33n) % 1000000n) / 1000000;
  }
}

/* ================================================================
 * Direction tables
 * ================================================================ */

const DIR4: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const DIR8: [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/* ================================================================
 * Directional bias helper
 * ================================================================ */

function computeBiasIdx(
  angleDeg: number,
  dirs: [number, number][],
): number {
  const rad = (angleDeg * Math.PI) / 180;
  const bx = Math.sin(rad);
  const by = -Math.cos(rad);
  let bestIdx = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < dirs.length; i++) {
    const dot = dirs[i][0] * bx + dirs[i][1] * by;
    if (dot > bestDot) {
      bestDot = dot;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function pickDir(
  dirs: [number, number][],
  biasIdx: number,
  biasStrength: number,
  rng: LCG,
): [number, number] {
  if (biasIdx >= 0 && biasStrength > 0 && rng.float01() < biasStrength) {
    return dirs[biasIdx];
  }
  return dirs[rng.intn(dirs.length)];
}

/* ================================================================
 * Seed placement strategies
 * ================================================================ */

function placeSeeds(
  cluster: Uint8Array,
  mask: Uint8Array,
  W: number,
  H: number,
  mode: string,
  count: number,
  rng: LCG,
): void {
  const valid: [number, number][] = [];
  let mxMin = W;
  let myMin = H;
  let mxMax = -1;
  let myMax = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x]) {
        valid.push([x, y]);
        if (x < mxMin) mxMin = x;
        if (x > mxMax) mxMax = x;
        if (y < myMin) myMin = y;
        if (y > myMax) myMax = y;
      }
    }
  }
  if (valid.length === 0) return;

  const cx = Math.floor((mxMin + mxMax) / 2);
  const cy = Math.floor((myMin + myMax) / 2);
  const seeds: [number, number][] = [];

  switch (mode) {
    case "center": {
      const sorted = valid.slice().sort((a, b) => {
        const da = (a[0] - cx) ** 2 + (a[1] - cy) ** 2;
        const db = (b[0] - cx) ** 2 + (b[1] - cy) ** 2;
        return da - db;
      });
      for (let i = 0; i < Math.min(count, sorted.length); i++) {
        seeds.push(sorted[i]);
      }
      break;
    }
    case "bottom": {
      const bottom = valid.filter(([, y]) => y >= myMax - 1);
      const pool = bottom.length > 0 ? bottom : valid;
      for (let i = 0; i < count; i++) {
        seeds.push(pool[rng.intn(pool.length)]);
      }
      break;
    }
    case "edges": {
      const edge: [number, number][] = [];
      for (const [x, y] of valid) {
        if (
          x === 0 ||
          x === W - 1 ||
          y === 0 ||
          y === H - 1 ||
          (x > 0 && !mask[y * W + x - 1]) ||
          (x < W - 1 && !mask[y * W + x + 1]) ||
          (y > 0 && !mask[(y - 1) * W + x]) ||
          (y < H - 1 && !mask[(y + 1) * W + x])
        ) {
          edge.push([x, y]);
        }
      }
      const pool = edge.length > 0 ? edge : valid;
      for (let i = 0; i < count; i++) {
        seeds.push(pool[rng.intn(pool.length)]);
      }
      break;
    }
    case "scatter": {
      if (valid.length <= count) {
        seeds.push(...valid);
        break;
      }
      const dist = new Float32Array(valid.length).fill(Infinity);
      const firstIdx = rng.intn(valid.length);
      seeds.push(valid[firstIdx]);
      for (let i = 0; i < valid.length; i++) {
        const dx = valid[i][0] - valid[firstIdx][0];
        const dy = valid[i][1] - valid[firstIdx][1];
        dist[i] = dx * dx + dy * dy;
      }
      for (let c = 1; c < count; c++) {
        let bestIdx = 0;
        let bestDist = -1;
        for (let i = 0; i < valid.length; i++) {
          if (dist[i] > bestDist) {
            bestDist = dist[i];
            bestIdx = i;
          }
        }
        seeds.push(valid[bestIdx]);
        for (let i = 0; i < valid.length; i++) {
          const dx = valid[i][0] - valid[bestIdx][0];
          const dy = valid[i][1] - valid[bestIdx][1];
          dist[i] = Math.min(dist[i], dx * dx + dy * dy);
        }
      }
      break;
    }
    case "random":
    default: {
      for (let i = 0; i < count; i++) {
        seeds.push(valid[rng.intn(valid.length)]);
      }
      break;
    }
  }

  for (const [x, y] of seeds) {
    cluster[y * W + x] = 1;
  }
}

/* ================================================================
 * Main export
 * ================================================================ */

export function generateDLA(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const srcGrid = input.grid as number[][] | undefined;
  if (
    !srcGrid ||
    srcGrid.length === 0 ||
    !srcGrid[0] ||
    srcGrid[0].length === 0
  ) {
    return { error: "grid is required" };
  }

  const H = srcGrid.length;
  const W = srcGrid[0].length;

  /* ---- Parameters ---- */

  const particleCount = Math.max(
    10,
    Math.min(5000, Math.floor((input.particleCount as number) ?? 300)),
  );
  const seedMode = (input.seedMode as string) ?? "center";
  const seedCount = Math.max(
    1,
    Math.min(20, Math.floor((input.seedCount as number) ?? 1)),
  );
  const stickiness = Math.max(
    0.01,
    Math.min(1, (input.stickiness as number) ?? 1.0),
  );
  const nModeStr = (input.neighborMode as string) ?? "8";
  const nMode = nModeStr === "4" ? 4 : 8;
  const biasAngle = Math.max(
    0,
    Math.min(360, (input.biasAngle as number) ?? 0),
  );
  const biasStrength = Math.max(
    0,
    Math.min(0.5, (input.biasStrength as number) ?? 0),
  );
  const maxSteps = Math.max(
    100,
    Math.min(50000, Math.floor((input.maxStepsPerParticle as number) ?? 5000)),
  );
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  // seed=0 → 当前时间戳（与 meta/README 描述一致：0=自动随机）。
  const baseSeed = seedRaw > 0 ? Math.floor(seedRaw) : (Date.now() & 0x7fffffff);
  const rng = new LCG(baseSeed);

  /* ---- Build flat mask ---- */

  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (srcGrid[y][x] !== 0) mask[y * W + x] = 1;
    }
  }

  let validCount = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) validCount++;
  if (validCount === 0) {
    return { grid: srcGrid.map((r) => r.map(() => 0)) };
  }

  /* ---- Initialise cluster ---- */

  const cluster = new Uint8Array(W * H);
  placeSeeds(cluster, mask, W, H, seedMode, seedCount, rng);

  const dirs = nMode === 4 ? DIR4 : DIR8;
  /* User-facing biasAngle = desired GROWTH direction.  Internally the walk
   * bias must point the OPPOSITE way: particles drifting toward the cluster
   * from the biasAngle side cause growth in that direction. */
  const walkAngle = biasStrength > 0 ? (biasAngle + 180) % 360 : 0;
  const biasIdx = biasStrength > 0 ? computeBiasIdx(walkAngle, dirs) : -1;

  /* ---- Cluster bounding box ---- */

  let bxMin = W;
  let byMin = H;
  let bxMax = -1;
  let byMax = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (cluster[y * W + x]) {
        if (x < bxMin) bxMin = x;
        if (x > bxMax) bxMax = x;
        if (y < byMin) byMin = y;
        if (y > byMax) byMax = y;
      }
    }
  }

  if (bxMax < 0) {
    return { grid: srcGrid.map((r) => r.map(() => 0)) };
  }

  /* ---- DLA main loop ---- */

  for (let p = 0; p < particleCount; p++) {
    /* Launch zone: cluster bbox expanded by a margin.
     * Kill zone: 2× the margin — particles that wander beyond are abandoned
     * so we don't waste cycles on particles drifting into empty space. */
    const bw = bxMax - bxMin + 1;
    const bh = byMax - byMin + 1;
    const diag = Math.sqrt(bw * bw + bh * bh);
    const margin = Math.max(5, Math.floor(diag * 0.5));
    const lxMin = Math.max(0, bxMin - margin);
    const lyMin = Math.max(0, byMin - margin);
    const lxMax = Math.min(W - 1, bxMax + margin);
    const lyMax = Math.min(H - 1, byMax + margin);
    const km = margin * 2;
    const kxMin = Math.max(0, bxMin - km);
    const kyMin = Math.max(0, byMin - km);
    const kxMax = Math.min(W - 1, bxMax + km);
    const kyMax = Math.min(H - 1, byMax + km);

    /* Find launch position (inside launch zone, in mask, not in cluster) */
    let px = -1;
    let py = -1;
    for (let a = 0; a < 300; a++) {
      const x = lxMin + rng.intn(lxMax - lxMin + 1);
      const y = lyMin + rng.intn(lyMax - lyMin + 1);
      if (mask[y * W + x] && !cluster[y * W + x]) {
        px = x;
        py = y;
        break;
      }
    }
    if (px < 0) {
      /* Fall back to any non-cluster mask cell */
      for (let a = 0; a < 200; a++) {
        const x = rng.intn(W);
        const y = rng.intn(H);
        if (mask[y * W + x] && !cluster[y * W + x]) {
          px = x;
          py = y;
          break;
        }
      }
    }
    if (px < 0) break; // cluster likely filled the mask

    /* Random walk */
    for (let step = 0; step < maxSteps; step++) {
      /* Check adjacency to cluster */
      let adjacent = false;
      for (let d = 0; d < dirs.length; d++) {
        const nx = px + dirs[d][0];
        const ny = py + dirs[d][1];
        if (
          nx >= 0 &&
          nx < W &&
          ny >= 0 &&
          ny < H &&
          cluster[ny * W + nx]
        ) {
          adjacent = true;
          break;
        }
      }

      if (adjacent) {
        if (rng.float01() < stickiness) {
          cluster[py * W + px] = 1;
          if (px < bxMin) bxMin = px;
          if (px > bxMax) bxMax = px;
          if (py < byMin) byMin = py;
          if (py > byMax) byMax = py;
          break;
        }
        /* Bounced — continue walking */
      }

      /* Step in a (possibly biased) random direction */
      const [dx, dy] = pickDir(dirs, biasIdx, biasStrength, rng);
      const nx = px + dx;
      const ny = py + dy;

      if (
        nx >= 0 &&
        nx < W &&
        ny >= 0 &&
        ny < H &&
        mask[ny * W + nx] &&
        !cluster[ny * W + nx]
      ) {
        px = nx;
        py = ny;
      }

      /* Kill if particle wandered outside kill zone */
      if (px < kxMin || px > kxMax || py < kyMin || py > kyMax) break;
    }
  }

  /* ---- Build output grid ---- */

  const outGrid: number[][] = Array.from({ length: H }, () =>
    new Array(W).fill(0),
  );
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (cluster[y * W + x]) outGrid[y][x] = 1;
    }
  }

  return { grid: outGrid };
}
