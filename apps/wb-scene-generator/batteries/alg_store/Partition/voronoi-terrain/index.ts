/**
 * Voronoi Terrain Generator
 * Generates a region grid using Voronoi tessellation.
 * Each seed point [x, y] (absolute grid coordinates) defines a polygon region auto-assigned a unique ID (1, 2, 3...).
 *
 * Supports:
 *   - Lloyd relaxation for more uniform cell distribution
 *   - Inverse-distance-weighted blending for smooth inter-cell transitions
 *   - Bounded mode: adds invisible "boundary seeds" around land seeds so that
 *     Voronoi cells don't extend to the map edges (DST-style ocean-seed boundary).
 *
 * Self-contained — no external imports.
 */

export interface VoronoiTerrainInput {
  width?: number;
  height?: number;
  seeds?: number[][];
  numSeeds?: number;
  relaxIterations?: number;
  distanceType?: 'euclidean' | 'manhattan' | 'chebyshev';
  smooth?: number;
  seed?: number;
  bounded?: boolean;
  boundaryValue?: number;
  boundaryGap?: number;
}

export interface VoronoiTerrainOutput {
  grid: number[][];
}

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

/** Integer hash → [0, 1) for deterministic boundary-seed jitter. */
function hashNoise2D(ix: number, iy: number, salt: number): number {
  let h = (ix * 374761393 + iy * 668265263 + salt * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h & 0x7fff) / 0x8000;
}

function distEuclidean(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}
function distManhattan(x1: number, y1: number, x2: number, y2: number): number {
  return Math.abs(x2 - x1) + Math.abs(y2 - y1);
}
function distChebyshev(x1: number, y1: number, x2: number, y2: number): number {
  return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
}

type DistFn = (x1: number, y1: number, x2: number, y2: number) => number;

interface SeedPoint {
  x: number;
  y: number;
  v: number;
}

export function generateVoronoiTerrain(
  input: VoronoiTerrainInput,
): VoronoiTerrainOutput {
  const w = Math.max(8, Math.min(1024, Math.floor(input.width ?? 128)));
  const h = Math.max(8, Math.min(1024, Math.floor(input.height ?? 128)));
  const relaxIter = Math.max(
    0,
    Math.min(50, Math.floor(input.relaxIterations ?? 3)),
  );
  const smooth = Math.max(0, Math.min(10, input.smooth ?? 0));
  const rng = new LCG(input.seed ?? 0);
  const bounded = input.bounded ?? false;
  const bndVal = input.boundaryValue ?? 0;
  const bndGap = Math.max(0.1, Math.min(2.0, input.boundaryGap ?? 0.8));

  const distFn: DistFn =
    input.distanceType === 'manhattan'
      ? distManhattan
      : input.distanceType === 'chebyshev'
        ? distChebyshev
        : distEuclidean;

  // ── Initialize seed points ──
  let seeds: SeedPoint[];

  // 用户显式传入 seeds 时（即使只有 1 个点），尊重其意图；只有完全没传 seeds
  // 时才用 numSeeds 随机生成。避免「传 1 个点静默改随机」的语义陷阱。
  if (Array.isArray(input.seeds)) {
    if (input.seeds.length === 0) {
      return { grid: Array.from({ length: h }, () => new Array(w).fill(bndVal)) };
    }
    seeds = input.seeds.map((s, i) => ({
      x: s[0] ?? 0,
      y: s[1] ?? 0,
      v: i + 1,
    }));
  } else {
    const n = Math.max(2, Math.min(500, Math.floor(input.numSeeds ?? 20)));
    seeds = [];
    for (let i = 0; i < n; i++) {
      seeds.push({
        x: rng.float01() * w,
        y: rng.float01() * h,
        v: i + 1,
      });
    }
  }

  // ── Lloyd relaxation (land seeds only, before adding boundary seeds) ──
  for (let iter = 0; iter < relaxIter; iter++) {
    const sumX = new Float64Array(seeds.length);
    const sumY = new Float64Array(seeds.length);
    const cnt = new Float64Array(seeds.length);

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const cx = px + 0.5;
        const cy = py + 0.5;
        let minD = Infinity;
        let nearest = 0;
        for (let i = 0; i < seeds.length; i++) {
          const d = distFn(cx, cy, seeds[i].x, seeds[i].y);
          if (d < minD) {
            minD = d;
            nearest = i;
          }
        }
        sumX[nearest] += cx;
        sumY[nearest] += cy;
        cnt[nearest]++;
      }
    }

    for (let i = 0; i < seeds.length; i++) {
      if (cnt[i] > 0) {
        seeds[i].x = sumX[i] / cnt[i];
        seeds[i].y = sumY[i] / cnt[i];
      }
    }
  }

  // Number of "real" land seeds (boundary seeds will be appended after this index)
  const nLand = seeds.length;

  // ── Add boundary seeds (ocean-seed boundary technique) ──
  // Invisible seeds are placed on a grid covering the map. They participate in the
  // Voronoi computation, "compressing" land cells into finite-sized polygons.
  // Seeds that fall within `gap` distance of any land seed are discarded,
  // creating a buffer zone that controls polygon size.
  if (bounded) {
    let avgNN = Math.min(w, h) * 0.2;
    if (nLand > 1) {
      let totalDist = 0;
      for (let i = 0; i < nLand; i++) {
        let minD = Infinity;
        for (let j = 0; j < nLand; j++) {
          if (i === j) continue;
          const d = distFn(seeds[i].x, seeds[i].y, seeds[j].x, seeds[j].y);
          if (d < minD) minD = d;
        }
        totalDist += minD;
      }
      avgNN = totalDist / nLand;
    }
    const gap = avgNN * bndGap;

    // Grid step: ~half the avg nearest-neighbor distance gives adequate coverage
    const step = Math.max(4, avgNN * 0.5);
    const gnx = Math.ceil(w / step) + 2;
    const gny = Math.ceil(h / step) + 2;

    for (let gy = -1; gy <= gny; gy++) {
      for (let gx = -1; gx <= gnx; gx++) {
        let bx = (gx + 0.5) * step;
        let by = (gy + 0.5) * step;

        // Hash-based jitter for organic boundary edges
        bx += (hashNoise2D(gx, gy, 0) - 0.5) * step * 0.3;
        by += (hashNoise2D(gx, gy, 1) - 0.5) * step * 0.3;

        let tooClose = false;
        for (let i = 0; i < nLand; i++) {
          if (distFn(bx, by, seeds[i].x, seeds[i].y) < gap) {
            tooClose = true;
            break;
          }
        }

        if (!tooClose) {
          seeds.push({ x: bx, y: by, v: 0 });
        }
      }
    }
  }

  // ── Generate heightmap ──
  // seeds[0..nLand-1] = land seeds, seeds[nLand..] = boundary seeds.
  // Pixels nearest to a boundary seed are marked NaN, then filled with boundaryValue
  // after normalization.
  const grid: number[][] = Array.from({ length: h }, () =>
    new Array(w).fill(0),
  );

  if (smooth <= 0) {
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const cx = px + 0.5;
        const cy = py + 0.5;
        let minD = Infinity;
        let nearest = 0;
        for (let i = 0; i < seeds.length; i++) {
          const d = distFn(cx, cy, seeds[i].x, seeds[i].y);
          if (d < minD) {
            minD = d;
            nearest = i;
          }
        }
        grid[py][px] = nearest >= nLand ? NaN : seeds[nearest].v;
      }
    }
  } else {
    const power = 2 / smooth;
    const eps = 1e-6;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const cx = px + 0.5;
        const cy = py + 0.5;

        // Check boundary: find nearest seed among ALL seeds
        if (bounded) {
          let minD = Infinity;
          let nearest = 0;
          for (let i = 0; i < seeds.length; i++) {
            const d = distFn(cx, cy, seeds[i].x, seeds[i].y);
            if (d < minD) {
              minD = d;
              nearest = i;
            }
          }
          if (nearest >= nLand) {
            grid[py][px] = NaN;
            continue;
          }
        }

        // IDW among land seeds only
        let sumW = 0;
        let sumV = 0;
        for (let i = 0; i < nLand; i++) {
          const d = distFn(cx, cy, seeds[i].x, seeds[i].y);
          const weight = 1 / Math.pow(d + eps, power);
          sumW += weight;
          sumV += weight * seeds[i].v;
        }
        grid[py][px] = sumW > 0 ? sumV / sumW : 0;
      }
    }
  }

  // ── Fill boundary pixels with boundaryValue ──
  // No normalization: seed v values pass through to the output as-is.
  if (bounded) {
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        if (isNaN(grid[py][px])) {
          grid[py][px] = bndVal;
        }
      }
    }
  }

  return { grid };
}
