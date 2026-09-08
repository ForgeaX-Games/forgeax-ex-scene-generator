/**
 * delaunay_terrain: Delaunay triangulation terrain generator via Bowyer-Watson.
 * Given seed points (or random), computes Delaunay triangulation and rasterizes
 * each triangle onto a grid with a unique ID.
 * Input:  width, height, seeds, numSeeds, relaxIterations, seed
 * Output: grid (triangle IDs), triangles (info array), numTriangles
 */

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

/** Positive if (a→b→c) is CCW, negative if CW, zero if collinear. */
function orient2d(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** True if (dx,dy) lies strictly inside the circumcircle of triangle abc. */
function inCircumcircle(
  ax: number, ay: number,
  bx: number, by: number,
  cx: number, cy: number,
  dx: number, dy: number,
): boolean {
  const adx = ax - dx, ady = ay - dy;
  const bdx = bx - dx, bdy = by - dy;
  const cdx = cx - dx, cdy = cy - dy;

  const det =
    (adx * adx + ady * ady) * (bdx * cdy - cdx * bdy) -
    (bdx * bdx + bdy * bdy) * (adx * cdy - cdx * ady) +
    (cdx * cdx + cdy * cdy) * (adx * bdy - bdx * ady);

  const o = orient2d(ax, ay, bx, by, cx, cy);
  return o > 0 ? det > 0 : det < 0;
}

interface DelTri {
  i0: number;
  i1: number;
  i2: number;
}

/**
 * Bowyer-Watson incremental Delaunay triangulation.
 * px/py hold point coords; indices [0..n-1] are real points,
 * [n..n+2] are reserved for the super-triangle.
 */
function bowyerWatson(px: number[], py: number[], n: number): DelTri[] {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (px[i] < minX) minX = px[i];
    if (px[i] > maxX) maxX = px[i];
    if (py[i] < minY) minY = py[i];
    if (py[i] > maxY) maxY = py[i];
  }
  const dmax = Math.max(maxX - minX, maxY - minY) + 1;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  px[n] = midX - 20 * dmax;     py[n] = midY - dmax;
  px[n + 1] = midX;             py[n + 1] = midY + 20 * dmax;
  px[n + 2] = midX + 20 * dmax; py[n + 2] = midY - dmax;

  let tris: DelTri[] = [{ i0: n, i1: n + 1, i2: n + 2 }];

  for (let i = 0; i < n; i++) {
    const bad: Set<number> = new Set();
    for (let t = 0; t < tris.length; t++) {
      const tr = tris[t];
      if (inCircumcircle(
        px[tr.i0], py[tr.i0],
        px[tr.i1], py[tr.i1],
        px[tr.i2], py[tr.i2],
        px[i], py[i],
      )) {
        bad.add(t);
      }
    }

    // Boundary polygon: edges of bad triangles not shared by another bad triangle
    const edges: [number, number][] = [];
    for (const bi of bad) {
      const tr = tris[bi];
      const te: [number, number][] = [
        [tr.i0, tr.i1], [tr.i1, tr.i2], [tr.i2, tr.i0],
      ];
      for (const [a, b] of te) {
        let shared = false;
        for (const bj of bad) {
          if (bj === bi) continue;
          const ot = tris[bj];
          if (
            (a === ot.i0 && b === ot.i1) || (a === ot.i1 && b === ot.i0) ||
            (a === ot.i1 && b === ot.i2) || (a === ot.i2 && b === ot.i1) ||
            (a === ot.i2 && b === ot.i0) || (a === ot.i0 && b === ot.i2)
          ) {
            shared = true;
            break;
          }
        }
        if (!shared) edges.push([a, b]);
      }
    }

    const next: DelTri[] = [];
    for (let t = 0; t < tris.length; t++) {
      if (!bad.has(t)) next.push(tris[t]);
    }
    for (const [a, b] of edges) {
      next.push({ i0: i, i1: a, i2: b });
    }
    tris = next;
  }

  return tris.filter(t => t.i0 < n && t.i1 < n && t.i2 < n);
}

// --- Triangle rasterization ---

function triSign(
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
): number {
  return (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
}

function pointInTri(
  ptx: number, pty: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number,
): boolean {
  const d1 = triSign(ptx, pty, x1, y1, x2, y2);
  const d2 = triSign(ptx, pty, x2, y2, x3, y3);
  const d3 = triSign(ptx, pty, x3, y3, x1, y1);
  return !(((d1 < 0) || (d2 < 0) || (d3 < 0)) &&
           ((d1 > 0) || (d2 > 0) || (d3 > 0)));
}

function rasterize(
  grid: number[][],
  tris: DelTri[],
  px: number[],
  py: number[],
  w: number,
  h: number,
): void {
  for (let ti = 0; ti < tris.length; ti++) {
    const t = tris[ti];
    const x0 = px[t.i0], y0 = py[t.i0];
    const x1 = px[t.i1], y1 = py[t.i1];
    const x2 = px[t.i2], y2 = py[t.i2];

    const rMin = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const rMax = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)));
    const cMin = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const cMax = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)));

    const id = ti + 1;
    for (let r = rMin; r <= rMax; r++) {
      for (let c = cMin; c <= cMax; c++) {
        if (grid[r][c] === 0 &&
            pointInTri(c + 0.5, r + 0.5, x0, y0, x1, y1, x2, y2)) {
          grid[r][c] = id;
        }
      }
    }
  }
}

// --- Lloyd relaxation (Voronoi centroid) ---

function lloydRelax(
  px: number[], py: number[], n: number,
  w: number, h: number, iterations: number,
): void {
  for (let iter = 0; iter < iterations; iter++) {
    const sumX = new Float64Array(n);
    const sumY = new Float64Array(n);
    const cnt = new Float64Array(n);

    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const cx = c + 0.5;
        const cy = r + 0.5;
        let minD = Infinity;
        let nearest = 0;
        for (let i = 0; i < n; i++) {
          const dx = cx - px[i];
          const dy = cy - py[i];
          const d = dx * dx + dy * dy;
          if (d < minD) { minD = d; nearest = i; }
        }
        sumX[nearest] += cx;
        sumY[nearest] += cy;
        cnt[nearest]++;
      }
    }

    for (let i = 0; i < n; i++) {
      if (cnt[i] > 0) {
        px[i] = sumX[i] / cnt[i];
        py[i] = sumY[i] / cnt[i];
      }
    }
  }
}

export function delaunayTerrain(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const w = clamp(Math.floor(Number(input.width) || 128), 8, 1024);
  const h = clamp(Math.floor(Number(input.height) || 128), 8, 1024);
  const numSeeds = clamp(Math.floor(Number(input.numSeeds) || 20), 3, 500);
  const relaxIter = clamp(Math.floor(Number(input.relaxIterations) || 0), 0, 50);
  const seedVal = Math.floor(Number(input.seed) || 0);
  const rng = new LCG(seedVal);

  const rawSeeds = input.seeds as number[][] | undefined;
  let n: number;
  const px: number[] = new Array(503).fill(0);
  const py: number[] = new Array(503).fill(0);

  // 用户显式传入 seeds（哪怕 < 3 个点）应当尊重其意图，不再静默改随机。
  // Delaunay 三角化至少需要 3 个点，因此 1~2 点时返回空网格 + 错误说明。
  if (Array.isArray(rawSeeds)) {
    if (rawSeeds.length < 3) {
      return {
        grid: Array.from({ length: h }, () => new Array(w).fill(0)),
        triangles: [],
        error: `Delaunay triangulation requires at least 3 seed points; got ${rawSeeds.length}.`,
      };
    }
    n = Math.min(rawSeeds.length, 500);
    for (let i = 0; i < n; i++) {
      px[i] = clamp((rawSeeds[i][0] ?? 0) * w, 0, w);
      py[i] = clamp((rawSeeds[i][1] ?? 0) * h, 0, h);
    }
  } else {
    n = numSeeds;
    for (let i = 0; i < n; i++) {
      px[i] = rng.float01() * w;
      py[i] = rng.float01() * h;
    }
  }

  if (relaxIter > 0) {
    lloydRelax(px, py, n, w, h, relaxIter);
  }

  const tris = bowyerWatson(px, py, n);

  const grid: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));
  rasterize(grid, tris, px, py, w, h);

  const triInfo = tris.map((t, i) => ({
    id: i + 1,
    v0: [Math.round(px[t.i0] * 100) / 100, Math.round(py[t.i0] * 100) / 100],
    v1: [Math.round(px[t.i1] * 100) / 100, Math.round(py[t.i1] * 100) / 100],
    v2: [Math.round(px[t.i2] * 100) / 100, Math.round(py[t.i2] * 100) / 100],
  }));

  return { grid, triangles: triInfo, numTriangles: tris.length };
}
