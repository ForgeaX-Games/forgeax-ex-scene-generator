/**
 * Cave Tunnel Generator
 * Branching cave tunnel generator using 3D Perlin noise, width decay, and recursive branching.
 *
 * Algorithm:
 *   1. Flood-fill connected non-zero cells into rock groups
 *   2. For each group ≥ minGroupSize:
 *      - Open tunnels dig inward from edge cells
 *      - Closed tunnels dig from interior in random direction
 *   3. Tunnel width is determined by WIDTH_CURVE (scales with group size)
 *   4. Width decays by WIDTH_PER_CELL per step; stops at MIN_WIDTH
 *   5. Direction changes via 3D Perlin noise (4-octave, freq 0.00205)
 *   6. Recursive branching at 10% per step after BRANCH_AFTER steps
 *
 * Self-contained — no external imports.
 */

export interface CaveTunnelInput {
  grid?: number[][];
  maxOpenTunnels?: number;
  maxClosedTunnels?: number;
  minGroupSize?: number;
  tunnelWidth?: number;
  widthDecay?: number;
  minWidth?: number;
  branchChance?: number;
  branchAfter?: number;
  dirChangeSpeed?: number;
  seed?: number;
}

export interface CaveTunnelOutput {
  grid: number[][];
}

/* ================================================================
 * Seeded PRNG (LCG)
 * ================================================================ */

class LCG {
  private s: bigint;
  constructor(seed: number) {
    this.s = BigInt(seed > 0 ? seed : 54321);
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
  uniform(lo: number, hi: number): number {
    return lo + this.float01() * (hi - lo);
  }
  /** Inclusive random integer in [lo, hi]. */
  randint(lo: number, hi: number): number {
    if (hi <= lo) return lo;
    return lo + this.intn(hi - lo + 1);
  }
}

/* ================================================================
 * 3D Perlin Gradient Noise — ported from Verse.Noise.Perlin
 * ================================================================ */

class PerlinNoise3D {
  private readonly perm: Uint8Array;
  private readonly freq: number;
  private readonly lac: number;
  private readonly pers: number;
  private readonly oct: number;

  private static readonly GRADS: readonly number[][] = [
    [1, 1, 0],
    [-1, 1, 0],
    [1, -1, 0],
    [-1, -1, 0],
    [1, 0, 1],
    [-1, 0, 1],
    [1, 0, -1],
    [-1, 0, -1],
    [0, 1, 1],
    [0, -1, 1],
    [0, 1, -1],
    [0, -1, -1],
  ];

  constructor(
    frequency: number,
    lacunarity: number,
    persistence: number,
    octaves: number,
    seed: number,
  ) {
    this.freq = frequency;
    this.lac = lacunarity;
    this.pers = persistence;
    this.oct = octaves;

    const base = new Uint8Array(256);
    for (let i = 0; i < 256; i++) base[i] = i;

    let s = ((seed | 0) ^ 0x5bd1e995) >>> 0;
    const next32 = (): number => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (t ^ (t >>> 14)) >>> 0;
    };
    for (let i = 255; i > 0; i--) {
      const j = next32() % (i + 1);
      const tmp = base[i];
      base[i] = base[j];
      base[j] = tmp;
    }

    this.perm = new Uint8Array(512);
    for (let i = 0; i < 256; i++) {
      this.perm[i] = base[i];
      this.perm[i + 256] = base[i];
    }
  }

  private static fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  private grad(h: number, x: number, y: number, z: number): number {
    const g = PerlinNoise3D.GRADS[h % 12];
    return g[0] * x + g[1] * y + g[2] * z;
  }

  private noise(x: number, y: number, z: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const zi = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);
    const u = PerlinNoise3D.fade(xf);
    const v = PerlinNoise3D.fade(yf);
    const w = PerlinNoise3D.fade(zf);

    const p = this.perm;
    const aaa = p[p[p[xi] + yi] + zi];
    const aba = p[p[p[xi] + yi + 1] + zi];
    const aab = p[p[p[xi] + yi] + zi + 1];
    const abb = p[p[p[xi] + yi + 1] + zi + 1];
    const baa = p[p[p[xi + 1] + yi] + zi];
    const bba = p[p[p[xi + 1] + yi + 1] + zi];
    const bab = p[p[p[xi + 1] + yi] + zi + 1];
    const bbb = p[p[p[xi + 1] + yi + 1] + zi + 1];

    const lerp = (a: number, b: number, t: number) => a + t * (b - a);
    const g = this.grad.bind(this);

    const x1 = lerp(g(aaa, xf, yf, zf), g(baa, xf - 1, yf, zf), u);
    const x2 = lerp(g(aba, xf, yf - 1, zf), g(bba, xf - 1, yf - 1, zf), u);
    const y1 = lerp(x1, x2, v);

    const x3 = lerp(
      g(aab, xf, yf, zf - 1),
      g(bab, xf - 1, yf, zf - 1),
      u,
    );
    const x4 = lerp(
      g(abb, xf, yf - 1, zf - 1),
      g(bbb, xf - 1, yf - 1, zf - 1),
      u,
    );
    const y2 = lerp(x3, x4, v);

    return lerp(y1, y2, w);
  }

  getValue(x: number, y: number, z: number = 0): number {
    let total = 0;
    let amp = 1;
    let freq = this.freq;
    for (let i = 0; i < this.oct; i++) {
      total += this.noise(x * freq, y * freq, z * freq) * amp;
      freq *= this.lac;
      amp *= this.pers;
    }
    return total;
  }
}

/* ================================================================
 * WIDTH_CURVE — maps rock group size to base tunnel width
 * ================================================================ */

const WIDTH_CURVE: [number, number][] = [
  [100, 2.0],
  [300, 4.0],
  [3000, 5.5],
];

function curveEval(curve: [number, number][], x: number): number {
  if (x <= curve[0][0]) return curve[0][1];
  if (x >= curve[curve.length - 1][0]) return curve[curve.length - 1][1];
  for (let i = 0; i < curve.length - 1; i++) {
    const [x0, y0] = curve[i];
    const [x1, y1] = curve[i + 1];
    if (x0 <= x && x <= x1) {
      const t = x1 !== x0 ? (x - x0) / (x1 - x0) : 0;
      return y0 + t * (y1 - y0);
    }
  }
  return curve[curve.length - 1][1];
}

/* ================================================================
 * Main generator
 * ================================================================ */

export function generateCaveTunnel(
  input: CaveTunnelInput,
): CaveTunnelOutput {
  const mask = input.grid;
  if (!mask || mask.length === 0 || !mask[0] || mask[0].length === 0) {
    return { grid: [] };
  }

  const H = mask.length;
  const W = mask[0].length;
  const maxOpen = Math.max(0, Math.floor(input.maxOpenTunnels ?? 3));
  const maxClose = Math.max(0, Math.floor(input.maxClosedTunnels ?? 1));
  const minGroup = Math.max(1, Math.floor(input.minGroupSize ?? 20));
  const userWidth = input.tunnelWidth ?? 0;
  const wDecay = Math.max(0.001, input.widthDecay ?? 0.034);
  const minW = Math.max(0.5, input.minWidth ?? 1.4);
  const bChance = Math.max(0, Math.min(1, input.branchChance ?? 0.1));
  const bAfter = Math.max(0, Math.floor(input.branchAfter ?? 15));
  const dirSpd = Math.max(0, input.dirChangeSpeed ?? 8);
  const seedVal = input.seed ?? 0;
  const rng = new LCG(seedVal);

  const dirNoise = new PerlinNoise3D(0.00205, 2.0, 0.5, 4, seedVal + 500);

  const result: number[][] = Array.from({ length: H }, () =>
    new Array(W).fill(0),
  );
  const gidMap: number[][] = Array.from({ length: H }, () =>
    new Array(W).fill(0),
  );
  const tOwner: number[][] = Array.from({ length: H }, () =>
    new Array(W).fill(0),
  );
  let tTag = 0;

  /* ---- Flood fill connected rock groups ---- */

  interface Group {
    cells: [number, number][];
    id: number;
  }
  const groups: Group[] = [];
  let nextGid = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (gidMap[y][x] !== 0 || mask[y][x] === 0) continue;
      nextGid++;
      const cells: [number, number][] = [];
      const q: [number, number][] = [[x, y]];
      gidMap[y][x] = nextGid;
      let qi = 0;
      while (qi < q.length) {
        const [cx, cy] = q[qi++];
        cells.push([cx, cy]);
        const nb: [number, number][] = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (const [nx, ny] of nb) {
          if (
            nx >= 0 &&
            nx < W &&
            ny >= 0 &&
            ny < H &&
            gidMap[ny][nx] === 0 &&
            mask[ny][nx] !== 0
          ) {
            gidMap[ny][nx] = nextGid;
            q.push([nx, ny]);
          }
        }
      }
      if (cells.length >= minGroup) {
        groups.push({ cells, id: nextGid });
      }
    }
  }

  /* ---- Direction helpers ---- */

  function distToNonRock(
    sx: number,
    sy: number,
    deg: number,
    g: number,
    maxD: number,
  ): number {
    const rad = (deg * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    for (let s = 1; s <= maxD; s++) {
      const cx = Math.floor(sx + dx * s);
      const cy = Math.floor(sy + dy * s);
      if (
        cx < 0 ||
        cx >= W ||
        cy < 0 ||
        cy >= H ||
        gidMap[cy][cx] !== g
      ) {
        return s;
      }
    }
    return maxD;
  }

  function findBestDir(
    sx: number,
    sy: number,
    g: number,
  ): [number, number] {
    const dirs = [0, 45, 90, 135, 180, 225, 270, 315];
    const dists: number[] = [];
    for (const angle of dirs) {
      const rad = (angle * Math.PI) / 180;
      const dx = Math.cos(rad);
      const dy = Math.sin(rad);
      let d = 0;
      for (let step = 1; step <= 40; step++) {
        const cx = Math.floor(sx + dx * step);
        const cy = Math.floor(sy + dy * step);
        if (
          cx < 0 ||
          cx >= W ||
          cy < 0 ||
          cy >= H ||
          gidMap[cy][cx] !== g
        ) {
          break;
        }
        d = step;
      }
      dists.push(d);
    }
    const scores = dirs.map((_, i) => {
      const l = (i + 7) % 8;
      const r = (i + 1) % 8;
      return dists[i] + dists[l] * 0.5 + dists[r] * 0.5;
    });
    let bi = 0;
    for (let i = 1; i < 8; i++) {
      if (scores[i] > scores[bi]) bi = i;
    }
    return [dirs[bi], dists[bi]];
  }

  function findEdgeCells(group: Group): [number, number][] {
    const out: [number, number][] = [];
    for (const [x, y] of group.cells) {
      if (x <= 2 || y <= 2 || x >= W - 3 || y >= H - 3) continue;
      if (result[y][x] > 0) continue;
      if (
        (x > 0 && gidMap[y][x - 1] !== group.id) ||
        (x < W - 1 && gidMap[y][x + 1] !== group.id) ||
        (y > 0 && gidMap[y - 1][x] !== group.id) ||
        (y < H - 1 && gidMap[y + 1][x] !== group.id)
      ) {
        out.push([x, y]);
      }
    }
    return out;
  }

  /* ---- Recursive tunnel digging (faithful to _dig) ---- */

  function dig(
    startX: number,
    startY: number,
    direction: number,
    width: number,
    g: number,
    closed: boolean,
    tag: number,
    minBrDist: number,
  ): void {
    let px = startX;
    let py = startY;
    let ix = startX;
    let iy = startY;
    let dist = 0;
    let steps = 0;
    let branchedLeft = false;
    let branchedRight = false;
    let curW = width;

    while (curW >= minW) {
      // Closed-tunnel proximity check: abort if approaching other tunnel / non-rock
      if (closed) {
        const cr = Math.floor(curW / 2 + 1.5);
        const cr2 = (curW / 2 + 1.5) ** 2;
        let abort = false;
        for (let dy = -cr; dy <= cr && !abort; dy++) {
          for (let dx = -cr; dx <= cr && !abort; dx++) {
            if (dx * dx + dy * dy > cr2) continue;
            const cx = ix + dx;
            const cy = iy + dy;
            if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
            if (tOwner[cy][cx] === tag) continue;
            if (gidMap[cy][cx] !== g || result[cy][cx] > 0) abort = true;
          }
        }
        if (abort) return;
      }

      // Branching (C# DigInBestDirection)
      if (steps >= bAfter && curW > minW + 0.4) {
        if (!branchedLeft && rng.float01() < bChance) {
          const bw = curW - rng.uniform(0.2, 0.4);
          let bestBdir = direction + 60;
          let bestBd = -1;
          for (let t = 0; t < 6; t++) {
            const cand = direction + rng.uniform(40, 90);
            const d = distToNonRock(ix, iy, cand, g, 50);
            if (d > bestBd) {
              bestBd = d;
              bestBdir = cand;
            }
          }
          if (bestBd >= minBrDist) {
            dig(ix, iy, bestBdir, bw, g, closed, tag, minBrDist);
          }
          branchedLeft = true;
        }
        if (!branchedRight && rng.float01() < bChance) {
          const bw = curW - rng.uniform(0.2, 0.4);
          let bestBdir = direction - 60;
          let bestBd = -1;
          for (let t = 0; t < 6; t++) {
            const cand = direction - rng.uniform(40, 90);
            const d = distToNonRock(ix, iy, cand, g, 50);
            if (d > bestBd) {
              bestBd = d;
              bestBdir = cand;
            }
          }
          if (bestBd >= minBrDist) {
            dig(ix, iy, bestBdir, bw, g, closed, tag, minBrDist);
          }
          branchedRight = true;
        }
      }

      // Dig circular area
      let hitAnother = false;
      const r = Math.floor(curW / 2);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const cx = ix + dx;
          const cy = iy + dy;
          if (
            cx >= 0 &&
            cx < W &&
            cy >= 0 &&
            cy < H &&
            gidMap[cy][cx] === g
          ) {
            if (result[cy][cx] > 0 && tOwner[cy][cx] !== tag) {
              hitAnother = true;
            }
            result[cy][cx] = 1;
            tOwner[cy][cx] = tag;
          }
        }
      }
      if (hitAnother) break;

      // Advance position (uses Math.floor like Python int())
      while (Math.floor(px) === ix && Math.floor(py) === iy) {
        const rad = (direction * Math.PI) / 180;
        px += Math.cos(rad) * 0.5;
        py += Math.sin(rad) * 0.5;
        dist += 0.5;
      }
      ix = Math.floor(px);
      iy = Math.floor(py);

      if (
        ix < 0 ||
        ix >= W ||
        iy < 0 ||
        iy >= H ||
        gidMap[iy][ix] !== g
      ) {
        break;
      }

      // Direction perturbation via 3D Perlin noise (identical to original)
      const dn = dirNoise.getValue(
        dist * 60,
        startX * 200,
        startY * 200,
      );
      direction += dn * dirSpd;
      curW -= wDecay;
      steps++;
    }
  }

  /* ---- Generate tunnels for each qualified group ---- */

  for (const group of groups) {
    const sz = group.cells.length;

    // Tunnel base width: auto-scale from WIDTH_CURVE or user override
    const baseW = userWidth > 0 ? userWidth : curveEval(WIDTH_CURVE, sz);

    // Branch distance threshold: scale with group size (original is fixed 18)
    const minBrDist = Math.max(
      5,
      Math.min(18, Math.floor(Math.sqrt(sz) * 0.4)),
    );

    // Open tunnel count (original: round(sz * random(0.9,1.1) * 5.8/10000))
    let openCount = Math.min(
      maxOpen,
      Math.max(
        0,
        Math.round(sz * rng.uniform(0.9, 1.1) * 5.8 / 10000),
      ),
    );
    if (openCount > 0) openCount = rng.randint(1, openCount);

    // For small grids: guarantee at least 1 tunnel for qualifying groups
    if (openCount === 0 && sz >= minGroup) openCount = 1;

    const edges = findEdgeCells(group);
    if (edges.length > 0) {
      for (let i = 0; i < openCount; i++) {
        let bestStart: [number, number] = edges[0];
        let bestDist = -1;
        let bestDir = 0;
        for (let t = 0; t < Math.min(10, edges.length); t++) {
          const s = edges[rng.intn(edges.length)];
          const [d, dist] = findBestDir(s[0], s[1], group.id);
          if (dist > bestDist) {
            bestStart = s;
            bestDist = dist;
            bestDir = d;
          }
        }
        const w = rng.uniform(baseW * 0.8, baseW);
        tTag++;
        dig(
          bestStart[0],
          bestStart[1],
          bestDir,
          w,
          group.id,
          false,
          tTag,
          minBrDist,
        );
      }
    }

    // Closed tunnel count (original: round(sz * random(0.9,1.1) * 2.5/10000))
    let closedCount = Math.min(
      maxClose,
      Math.max(
        0,
        Math.round(sz * rng.uniform(0.9, 1.1) * 2.5 / 10000),
      ),
    );
    if (closedCount > 0) closedCount = rng.randint(0, closedCount);

    for (let i = 0; i < closedCount; i++) {
      let bestStart: [number, number] = group.cells[0];
      let bestDist = -1;
      for (let t = 0; t < 7; t++) {
        const s = group.cells[rng.intn(group.cells.length)];
        const [, dist] = findBestDir(s[0], s[1], group.id);
        if (dist > bestDist) {
          bestStart = s;
          bestDist = dist;
        }
      }
      const w = rng.uniform(baseW * 0.8, baseW);
      tTag++;
      dig(
        bestStart[0],
        bestStart[1],
        rng.uniform(0, 360),
        w,
        group.id,
        true,
        tTag,
        minBrDist,
      );
    }
  }

  return { grid: result };
}
