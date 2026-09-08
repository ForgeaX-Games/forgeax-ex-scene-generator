/**
 * gta_road — direction-field arterial growth + recursive block subdivision.
 *
 * Pipeline:
 *   1. Build θ(x,y) = baseAngle + organic * noise warp (± secondary axis π/2)
 *   2. Grow main arterials as agents along the field (branch / T-join / height cost)
 *   3. Find land \ main blocks; recursively bisect oversized blocks → aux skeleton
 *   4. Dilate main/aux to widths; merge (main=300, aux=301)
 */

type Grid = number[][];

interface NameEntry {
  id: number;
  name: string;
  type?: string;
}

interface Point {
  x: number;
  y: number;
}

interface Tip {
  x: number;
  y: number;
  angle: number;
  gen: number;
  stepsLeft: number;
}

const MAIN_ID = 300;
const AUX_ID = 301;
const DIR4: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function isGrid(value: unknown): value is Grid {
  return Array.isArray(value)
    && value.length > 0
    && Array.isArray(value[0])
    && ((value[0] as unknown[]).length === 0 || typeof (value[0] as unknown[])[0] === "number");
}

function makeGrid(rows: number, cols: number, fill = 0): Grid {
  return Array.from({ length: rows }, () => new Array(cols).fill(fill));
}

function binarize(grid: Grid): Grid {
  return grid.map((row) => row.map((v) => (v ? 1 : 0)));
}

function num(input: Record<string, unknown>, key: string, fallback: number): number {
  const v = input[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function int(input: Record<string, unknown>, key: string, fallback: number): number {
  return Math.round(num(input, key, fallback));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function resolveSeed(seed: unknown): number {
  const raw = typeof seed === "number" && Number.isFinite(seed) ? seed : 0;
  return raw === 0 ? 123456789 : raw >>> 0;
}

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x6d2b79f5;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function hash2(x: number, y: number, seed: number): number {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = x - x0;
  const yf = y - y0;
  return lerp(
    lerp(hash2(x0, y0, seed), hash2(x0 + 1, y0, seed), fade(xf)),
    lerp(hash2(x0, y0 + 1, seed), hash2(x0 + 1, y0 + 1, seed), fade(xf)),
    fade(yf),
  );
}

function fbm(x: number, y: number, seed: number, octaves = 3): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 1013);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / Math.max(1e-6, norm);
}

function inBounds(x: number, y: number, rows: number, cols: number): boolean {
  return x >= 0 && y >= 0 && x < cols && y < rows;
}

function dilate(mask: Grid, land: Grid, radius: number): Grid {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  if (radius <= 0) {
    const out = makeGrid(rows, cols, 0);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (mask[y][x] && land[y][x]) out[y][x] = 1;
      }
    }
    return out;
  }
  const out = makeGrid(rows, cols, 0);
  const r2 = radius * radius;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y][x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > r2) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(nx, ny, rows, cols)) continue;
          if (land[ny][nx]) out[ny][nx] = 1;
        }
      }
    }
  }
  return out;
}

function stampLine(skel: Grid, land: Grid, a: Point, b: Point): number {
  const rows = skel.length;
  const cols = skel[0]?.length ?? 0;
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 1.6));
  let painted = 0;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    if (!inBounds(x, y, rows, cols) || !land[y][x]) continue;
    if (!skel[y][x]) painted++;
    skel[y][x] = 1;
  }
  return painted;
}

function nearestRoad(
  skel: Grid,
  x: number,
  y: number,
  radius: number,
): Point | null {
  const rows = skel.length;
  const cols = skel[0]?.length ?? 0;
  let best: Point | null = null;
  let bestD = Infinity;
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const nx = Math.round(x) + dx;
      const ny = Math.round(y) + dy;
      if (!inBounds(nx, ny, rows, cols) || !skel[ny][nx]) continue;
      const d = Math.hypot(dx, dy);
      if (d < bestD && d <= radius) {
        bestD = d;
        best = { x: nx, y: ny };
      }
    }
  }
  return best;
}

/** Direction field: primary axis + soft secondary preference via noise. */
function fieldAngle(
  x: number,
  y: number,
  baseRad: number,
  organic: number,
  seed: number,
): number {
  const scale = 0.035;
  const n1 = fbm(x * scale, y * scale, seed, 3);
  const n2 = fbm(x * scale * 0.55 + 40, y * scale * 0.55 - 17, seed + 77, 2);
  // Warp primary axis; occasionally flip toward secondary (π/2) when n2 high.
  const warp = (n1 - 0.5) * Math.PI * 0.9 * organic;
  const secondaryPull = (n2 - 0.35) * organic;
  const useSecondary = secondaryPull > 0.35;
  const axis = useSecondary ? baseRad + Math.PI / 2 : baseRad;
  const fine = (n2 - 0.5) * 0.55 * organic;
  return axis + warp + fine;
}

function heightCost(heightMap: Grid | null, x: number, y: number): number {
  if (!heightMap) return 0;
  const h = heightMap[y]?.[x];
  if (typeof h !== "number") return 0;
  // Prefer low ground; steep local gradient also costly.
  let grad = 0;
  const c = h;
  for (const [dx, dy] of DIR4) {
    const nh = heightMap[y + dy]?.[x + dx];
    if (typeof nh === "number") grad = Math.max(grad, Math.abs(nh - c));
  }
  return c * 0.015 + grad * 0.08;
}

function pickArterialSeeds(
  land: Grid,
  count: number,
  rng: () => number,
): Point[] {
  const rows = land.length;
  const cols = land[0]?.length ?? 0;
  const landCells: Point[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (land[y][x]) landCells.push({ x, y });
    }
  }
  if (landCells.length === 0) return [];

  // Stratified: sample well-spaced points via greedy farthest-point.
  const seeds: Point[] = [];
  const first = landCells[Math.floor(rng() * landCells.length)];
  seeds.push(first);
  while (seeds.length < count) {
    let best: Point | null = null;
    let bestMin = -1;
    // Subsample candidates for speed.
    const trials = Math.min(landCells.length, 400);
    for (let t = 0; t < trials; t++) {
      const p = landCells[Math.floor(rng() * landCells.length)];
      let minD = Infinity;
      for (const s of seeds) {
        const d = Math.hypot(p.x - s.x, p.y - s.y);
        if (d < minD) minD = d;
      }
      if (minD > bestMin) {
        bestMin = minD;
        best = p;
      }
    }
    if (!best || bestMin < 6) break;
    seeds.push(best);
  }
  return seeds;
}

function growMainRoads(
  land: Grid,
  heightMap: Grid | null,
  opts: {
    seed: number;
    rng: () => number;
    baseRad: number;
    organic: number;
    mainCount: number;
    segmentLen: number;
    branchProb: number;
    connectRadius: number;
  },
): Grid {
  const rows = land.length;
  const cols = land[0]?.length ?? 0;
  const skel = makeGrid(rows, cols, 0);
  const tips: Tip[] = [];

  const seeds = pickArterialSeeds(land, opts.mainCount, opts.rng);
  const maxSteps = Math.max(30, Math.floor(Math.hypot(rows, cols) / Math.max(4, opts.segmentLen / 2)));

  for (const s of seeds) {
    const ang = fieldAngle(s.x, s.y, opts.baseRad, opts.organic, opts.seed);
    // Bidirectional growth from each seed.
    tips.push({ x: s.x, y: s.y, angle: ang, gen: 0, stepsLeft: maxSteps });
    tips.push({
      x: s.x,
      y: s.y,
      angle: ang + Math.PI,
      gen: 0,
      stepsLeft: maxSteps,
    });
    skel[s.y][s.x] = 1;
  }

  let guard = 0;
  const guardMax = tips.length * maxSteps * 2 + 2000;

  while (tips.length > 0 && guard++ < guardMax) {
    const tip = tips.pop()!;
    if (tip.stepsLeft <= 0) continue;

    const field = fieldAngle(tip.x, tip.y, opts.baseRad, opts.organic, opts.seed);
    // Blend current heading with field (keeps continuity, follows warp).
    let dAng = field - tip.angle;
    while (dAng > Math.PI) dAng -= Math.PI * 2;
    while (dAng < -Math.PI) dAng += Math.PI * 2;
    // Also allow the anti-parallel field (same axis, opposite sense).
    let dAng2 = field + Math.PI - tip.angle;
    while (dAng2 > Math.PI) dAng2 -= Math.PI * 2;
    while (dAng2 < -Math.PI) dAng2 += Math.PI * 2;
    if (Math.abs(dAng2) < Math.abs(dAng)) dAng = dAng2;

    const jitter = (opts.rng() - 0.5) * 0.35 * opts.organic;
    const nextAngle = tip.angle + clamp(dAng, -0.55, 0.55) + jitter;

    const len = opts.segmentLen * (0.75 + opts.rng() * 0.5);
    const tx = tip.x + Math.cos(nextAngle) * len;
    const ty = tip.y + Math.sin(nextAngle) * len;
    const end = { x: Math.round(tx), y: Math.round(ty) };

    if (!inBounds(end.x, end.y, rows, cols) || !land[end.y][end.x]) {
      // Try a shorter step or slight turn before giving up.
      let rescued = false;
      for (const turn of [-0.7, 0.7, -1.2, 1.2]) {
        const a2 = nextAngle + turn;
        const e2 = {
          x: Math.round(tip.x + Math.cos(a2) * (len * 0.6)),
          y: Math.round(tip.y + Math.sin(a2) * (len * 0.6)),
        };
        if (inBounds(e2.x, e2.y, rows, cols) && land[e2.y][e2.x]) {
          stampLine(skel, land, { x: Math.round(tip.x), y: Math.round(tip.y) }, e2);
          tips.push({
            x: e2.x,
            y: e2.y,
            angle: a2,
            gen: tip.gen,
            stepsLeft: tip.stepsLeft - 1,
          });
          rescued = true;
          break;
        }
      }
      if (!rescued) continue;
      continue;
    }

    // Height rejection: skip expensive climbs occasionally.
    if (heightCost(heightMap, end.x, end.y) > 0.9 + opts.rng()) {
      tip.angle = nextAngle + (opts.rng() - 0.5);
      tip.stepsLeft -= 1;
      tips.push(tip);
      continue;
    }

    // Snap to existing road → T-junction.
    const near = nearestRoad(skel, end.x, end.y, opts.connectRadius);
    const start = { x: Math.round(tip.x), y: Math.round(tip.y) };
    if (near && (near.x !== start.x || near.y !== start.y)) {
      const distFromStart = Math.hypot(near.x - start.x, near.y - start.y);
      if (distFromStart > 2) {
        stampLine(skel, land, start, near);
      }
      // Branch from junction sometimes.
      if (opts.rng() < opts.branchProb * 0.5 && tip.gen < 3) {
        const branchAng = nextAngle + (opts.rng() < 0.5 ? 1 : -1) * (Math.PI / 2 + (opts.rng() - 0.5) * 0.4);
        tips.push({
          x: near.x,
          y: near.y,
          angle: branchAng,
          gen: tip.gen + 1,
          stepsLeft: Math.floor(tip.stepsLeft * 0.55),
        });
      }
      continue;
    }

    stampLine(skel, land, start, end);

    tips.push({
      x: end.x,
      y: end.y,
      angle: nextAngle,
      gen: tip.gen,
      stepsLeft: tip.stepsLeft - 1,
    });

    if (opts.rng() < opts.branchProb && tip.gen < 4) {
      const side = opts.rng() < 0.5 ? 1 : -1;
      const branchAng =
        nextAngle + side * (Math.PI / 2 + (opts.rng() - 0.5) * 0.5 * opts.organic);
      tips.push({
        x: end.x,
        y: end.y,
        angle: branchAng,
        gen: tip.gen + 1,
        stepsLeft: Math.floor(maxSteps * (0.35 + opts.rng() * 0.35)),
      });
    }
  }

  return skel;
}

function collectComponents(mask: Grid, land: Grid): Point[][] {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const seen = new Uint8Array(rows * cols);
  const out: Point[][] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const start = y * cols + x;
      if (seen[start] || !land[y][x] || mask[y][x]) continue;
      const cells: Point[] = [];
      const queue = [start];
      seen[start] = 1;
      for (let head = 0; head < queue.length; head++) {
        const idx = queue[head];
        const cx = idx % cols;
        const cy = Math.floor(idx / cols);
        cells.push({ x: cx, y: cy });
        for (const [dx, dy] of DIR4) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!inBounds(nx, ny, rows, cols)) continue;
          const ni = ny * cols + nx;
          if (seen[ni] || !land[ny][nx] || mask[ny][nx]) continue;
          seen[ni] = 1;
          queue.push(ni);
        }
      }
      out.push(cells);
    }
  }
  return out;
}

function blockOrientation(cells: Point[]): number {
  const n = cells.length;
  if (n < 3) return 0;
  let sx = 0;
  let sy = 0;
  for (const p of cells) {
    sx += p.x;
    sy += p.y;
  }
  const cx = sx / n;
  const cy = sy / n;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const p of cells) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }
  return 0.5 * Math.atan2(2 * xy, xx - yy);
}

function blockSpan(cells: Point[], angle: number): { along: number; across: number; center: Point } {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  let sx = 0;
  let sy = 0;
  for (const p of cells) {
    sx += p.x;
    sy += p.y;
    const u = p.x * ca + p.y * sa;
    const v = -p.x * sa + p.y * ca;
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  return {
    along: uMax - uMin,
    across: vMax - vMin,
    center: { x: sx / cells.length, y: sy / cells.length },
  };
}

/**
 * Raster bipartition: assign each block cell to a side of a cut plane,
 * paint the interface as aux road. Guarantees the cut actually splits the blob
 * (geometric line stamps often miss irregular blocks).
 */
function cutBlock(
  cells: Point[],
  cutAngle: number,
  jitterFrac: number,
  rng: () => number,
): { road: Point[]; left: Point[]; right: Point[] } | null {
  if (cells.length < 8) return null;
  const span = blockSpan(cells, cutAngle);
  if (Math.min(span.along, span.across) < 4) return null;

  // Projection axis = cut normal (cells split by signed distance).
  const nx = Math.cos(cutAngle);
  const ny = Math.sin(cutAngle);
  const projections = cells.map((p) => p.x * nx + p.y * ny);
  projections.sort((a, b) => a - b);
  const mid = projections[Math.floor(projections.length / 2)];
  const jitterRange = (projections[projections.length - 1] - projections[0]) * jitterFrac;
  const threshold = mid + (rng() - 0.5) * jitterRange;

  const side = new Map<number, number>();
  const stride = 100000;
  for (const p of cells) {
    const proj = p.x * nx + p.y * ny;
    side.set(p.y * stride + p.x, proj >= threshold ? 1 : 0);
  }

  const road: Point[] = [];
  const left: Point[] = [];
  const right: Point[] = [];
  const cellSet = new Set(cells.map((p) => p.y * stride + p.x));

  for (const p of cells) {
    const key = p.y * stride + p.x;
    const s = side.get(key)!;
    let border = false;
    for (const [dx, dy] of DIR4) {
      const nk = (p.y + dy) * stride + (p.x + dx);
      if (!cellSet.has(nk)) continue;
      if (side.get(nk) !== s) {
        border = true;
        break;
      }
    }
    if (border) road.push(p);
    else if (s === 0) left.push(p);
    else right.push(p);
  }

  // Reject degenerate cuts that leave one side tiny.
  if (left.length < 4 || right.length < 4 || road.length < 2) return null;
  return { road, left, right };
}

function subdivideBlocks(
  land: Grid,
  mainSkel: Grid,
  opts: {
    seed: number;
    rng: () => number;
    baseRad: number;
    organic: number;
    maxBlockArea: number;
    minBlockSpan: number;
  },
): Grid {
  const rows = land.length;
  const cols = land[0]?.length ?? 0;
  const occupied = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (mainSkel[y][x]) occupied[y][x] = 1;
    }
  }
  const aux = makeGrid(rows, cols, 0);

  const queue = collectComponents(occupied, land);
  let safety = 0;
  const safetyMax = 8000;

  while (queue.length > 0 && safety++ < safetyMax) {
    const cells = queue.pop()!;
    if (cells.length < opts.maxBlockArea) continue;

    const orient = blockOrientation(cells);
    const span = blockSpan(cells, orient);
    if (Math.min(span.along, span.across) < opts.minBlockSpan * 2) continue;

    // Cut plane normal ≈ along long axis → road runs across the short direction.
    let cutAngle = span.along >= span.across ? orient : orient + Math.PI / 2;
    const field = fieldAngle(
      span.center.x,
      span.center.y,
      opts.baseRad,
      opts.organic,
      opts.seed,
    );
    let d = field - cutAngle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    // Also try field+π/2 (street axis).
    let d2 = field + Math.PI / 2 - cutAngle;
    while (d2 > Math.PI) d2 -= Math.PI * 2;
    while (d2 < -Math.PI) d2 += Math.PI * 2;
    if (Math.abs(d2) < Math.abs(d)) d = d2;
    cutAngle += clamp(d, -0.7, 0.7) * (0.4 + 0.4 * opts.organic);
    cutAngle += (opts.rng() - 0.5) * 0.4 * opts.organic;

    const cut = cutBlock(cells, cutAngle, 0.2 * opts.organic + 0.05, opts.rng);
    if (!cut) continue;

    for (const p of cut.road) {
      if (!land[p.y]?.[p.x] || mainSkel[p.y]?.[p.x]) continue;
      aux[p.y][p.x] = 1;
      occupied[p.y][p.x] = 1;
    }

    // Children = remaining open cells on each side (road cells already occupied).
    for (const side of [cut.left, cut.right]) {
      // Re-flood in case road pinched the side into multiple pieces.
      const sideSet = new Set(side.map((p) => p.y * cols + p.x));
      const seen = new Set<number>();
      for (const p of side) {
        const start = p.y * cols + p.x;
        if (seen.has(start) || occupied[p.y][p.x]) continue;
        const child: Point[] = [];
        const q = [start];
        seen.add(start);
        for (let head = 0; head < q.length; head++) {
          const idx = q[head];
          const cx = idx % cols;
          const cy = Math.floor(idx / cols);
          if (!sideSet.has(idx)) continue;
          child.push({ x: cx, y: cy });
          for (const [dx, dy] of DIR4) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (!inBounds(nx, ny, rows, cols)) continue;
            const ni = ny * cols + nx;
            if (seen.has(ni) || !sideSet.has(ni)) continue;
            if (occupied[ny][nx] || !land[ny][nx]) continue;
            seen.add(ni);
            q.push(ni);
          }
        }
        if (child.length >= opts.maxBlockArea) queue.push(child);
      }
    }
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (mainSkel[y][x]) aux[y][x] = 0;
    }
  }
  return aux;
}

function countOnes(grid: Grid): number {
  let n = 0;
  for (const row of grid) for (const v of row) if (v) n++;
  return n;
}

export function gtaRoad(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.landGrid)) return { error: "landGrid is required" };

  const land = binarize(input.landGrid as Grid);
  const rows = land.length;
  const cols = land[0]?.length ?? 0;
  const heightMap = isGrid(input.heightMap) ? (input.heightMap as Grid) : null;

  const seed = resolveSeed(input.seed);
  const rng = makeRng(seed);
  const baseAngleDeg = clamp(num(input, "baseAngle", 25), 0, 90);
  const baseRad = (baseAngleDeg * Math.PI) / 180;
  const organic = clamp(num(input, "organic", 0.45), 0, 1);
  const landArea = countOnes(land);
  const mainCount = clamp(
    Math.min(int(input, "mainCount", 5), Math.max(1, Math.floor(landArea / 400))),
    1,
    24,
  );
  const segmentLen = clamp(int(input, "segmentLen", 16), 6, 48);
  const branchProb = clamp(num(input, "branchProb", 0.28), 0, 0.8);
  const maxBlockArea = clamp(int(input, "maxBlockArea", 280), 40, 8000);
  const minBlockSpan = clamp(int(input, "minBlockSpan", 8), 3, 40);
  const mainWidth = clamp(int(input, "mainWidth", 3), 1, 9);
  const auxWidth = clamp(int(input, "auxWidth", 1), 1, 5);
  const connectRadius = clamp(int(input, "connectRadius", 4), 1, 12);

  if (landArea === 0) {
    const empty = makeGrid(rows, cols, 0);
    return {
      mainRoadGrid: empty,
      auxRoadGrid: empty,
      roadGrid: empty,
      outputGrid: empty,
      outputNameList: [],
    };
  }

  const mainSkel = growMainRoads(land, heightMap, {
    seed,
    rng,
    baseRad,
    organic,
    mainCount,
    segmentLen,
    branchProb,
    connectRadius,
  });

  const auxSkel = subdivideBlocks(land, mainSkel, {
    seed,
    rng,
    baseRad,
    organic,
    maxBlockArea,
    minBlockSpan,
  });

  const mainDil = Math.floor((mainWidth - 1) / 2);
  const auxDil = Math.floor((auxWidth - 1) / 2);
  const mainRoadGrid = dilate(mainSkel, land, mainDil);
  const auxRoadGrid = dilate(auxSkel, land, auxDil);

  // Aux must not overwrite main footprint.
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (mainRoadGrid[y][x]) auxRoadGrid[y][x] = 0;
    }
  }

  const roadGrid = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (mainRoadGrid[y][x]) roadGrid[y][x] = MAIN_ID;
      else if (auxRoadGrid[y][x]) roadGrid[y][x] = AUX_ID;
    }
  }

  const NAMES: NameEntry[] = [
    { id: MAIN_ID, name: "主路", type: "tile" },
    { id: AUX_ID, name: "辅路", type: "tile" },
  ];

  return {
    mainRoadGrid,
    auxRoadGrid,
    roadGrid,
    outputGrid: roadGrid,
    outputNameList: NAMES,
  };
}
