/**
 * newIslandRegionGen: 指定锚点 + 竞争 BFS 膨胀岛屿生成
 *
 * 与 island_poisson_gen 的唯一差异：不再用 Bridson 泊松盘随机采样锚点，而是直接把
 * 外部传入的 points 列表当作各岛锚点（每点一岛，islandId = index + 1）。其余「子种子
 * 散布 → 竞争 BFS 膨胀 → 去碎片 → 多数投票平滑」链路与 island_poisson_gen 内部算法完全一致。
 *
 * 1. points 锚点 → 每点衍生多个子种子 → 形成多叶有机 blob 形状
 * 2. 竞争 BFS 膨胀 → 各岛屿独立生长，在 grid 掩码内扩张
 * 3. 去除小碎片 + 多数投票平滑
 * 4. 输出 islandGrid（陆地）+ waterGrid（水面）+ regionGrid（各岛 ID）
 *
 * 每个岛的 subSeeds / subSpacing / minArea / smoothRadius 沿用 island_poisson_gen 中
 * 按 islandSize 派生的公式，仅把全局 islandSize 换成该岛自己的 islandSizes[i]。
 */

// ─── LCG ─────────────────────────────────────────────────────────────────────

class LCG {
  private state: bigint;
  constructor(seed: number) {
    const s = Math.abs(Math.round(seed)) % 2147483647 || 12345;
    this.state = BigInt(s);
  }
  next(): bigint {
    this.state =
      (this.state * 6364136223846793005n + 1442695040888963407n) &
      0xffffffffffffffffn;
    return this.state;
  }
  float64(): number {
    return Number(this.next() & 0xffffffffn) / 0xffffffff;
  }
}

// ─── 空间哈希（边缘有机化）───────────────────────────────────────────────────

function hash2d(ix: number, iy: number, seed: number): number {
  let h =
    Math.imul(ix, 1619) ^
    Math.imul(iy, 31337) ^
    Math.imul(seed % 99991, 1013904223);
  h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 15), 0xc4ceb9fe);
  return (h >>> 0) / 4294967296;
}

interface Point { x: number; y: number }

// ─── 子种子散布（多叶有机形状）──────────────────────────────────────────────

interface SubSeed { x: number; y: number; islandId: number; maxR: number }

function placeSubSeeds(
  anchor: Point, islandId: number,
  w: number, h: number,
  mask: number[][],
  subCount: number, maxR: number, radiusVar: number,
  subSpacing: number, rng: LCG
): SubSeed[] {
  const seeds: SubSeed[] = [];
  const r0 = maxR * (1 - radiusVar + rng.float64() * radiusVar * 2);
  seeds.push({ x: anchor.x, y: anchor.y, islandId, maxR: Math.max(3, r0) });

  for (let a = 0; a < subCount * 80 && seeds.length < subCount; a++) {
    const angle = rng.float64() * Math.PI * 2;
    const dist = subSpacing * (0.5 + rng.float64());
    const sx = Math.round(anchor.x + Math.cos(angle) * dist);
    const sy = Math.round(anchor.y + Math.sin(angle) * dist);
    if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;

    let ok = true;
    for (const s of seeds) {
      const dx = sx - s.x, dy = sy - s.y;
      if (dx * dx + dy * dy < subSpacing * subSpacing * 0.6) { ok = false; break; }
    }
    if (ok) {
      const r = maxR * (0.5 + rng.float64() * 0.7);
      seeds.push({ x: sx, y: sy, islandId, maxR: Math.max(3, r) });
    }
  }
  return seeds;
}

// ─── 竞争 BFS 膨胀 ───────────────────────────────────────────────────────────

function competitiveGrow(
  w: number, h: number,
  mask: number[][],
  seeds: SubSeed[],
  noiseSeed: number,
  rng: LCG
): number[][] {
  const grid: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));
  const queue: Array<[number, number, number]> = [];
  let head = 0;

  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    if (s.x >= 0 && s.x < w && s.y >= 0 && s.y < h) {
      grid[s.y][s.x] = s.islandId;
      queue.push([s.x, s.y, i]);
    }
  }

  const dirs: Array<[number, number]> = [
    [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
  ];

  while (head < queue.length) {
    const [cx, cy, si] = queue[head++];
    const seed = seeds[si];

    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.abs(Number(rng.next() % BigInt(i + 1)));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }

    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      if (mask[ny][nx] === 0) continue;
      if (grid[ny][nx] !== 0) continue;

      const ddx = nx - seed.x, ddy = ny - seed.y;
      if (ddx * ddx + ddy * ddy > seed.maxR * seed.maxR) continue;

      const dist = Math.sqrt(ddx * ddx + ddy * ddy);
      const noise = hash2d(nx, ny, noiseSeed) * 2 - 1;
      const prob = 0.88 * (1 - dist / seed.maxR) + noise * 0.15;

      if (rng.float64() < prob) {
        grid[ny][nx] = seed.islandId;
        queue.push([nx, ny, si]);
      }
    }
  }
  return grid;
}

// ─── 去除小碎片 ──────────────────────────────────────────────────────────────

function removeSmallIslands(grid: number[][], w: number, h: number, minArea: number): number[][] {
  const result = grid.map(row => [...row]);
  const visited = Array.from({ length: h }, () => new Uint8Array(w));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!result[y][x] || visited[y][x]) continue;
      const id = result[y][x];
      const cells: Array<[number, number]> = [];
      const q: Array<[number, number]> = [[x, y]];
      visited[y][x] = 1;
      while (q.length) {
        const [cx, cy] = q.shift()!;
        cells.push([cx, cy]);
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && result[ny][nx] === id && !visited[ny][nx]) {
            visited[ny][nx] = 1;
            q.push([nx, ny]);
          }
        }
      }
      if (cells.length < minArea) for (const [cx, cy] of cells) result[cy][cx] = 0;
    }
  }
  return result;
}

// ─── 多数投票平滑（保持各岛 ID，消除锯齿边缘）──────────────────────────────

function majoritySmooth(
  grid: number[][], w: number, h: number,
  radius: number, iterations: number
): number[][] {
  let cur = grid.map(row => [...row]);
  for (let iter = 0; iter < iterations; iter++) {
    const next = cur.map(row => [...row]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const votes = new Map<number, number>();
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy > radius * radius) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const v = cur[ny][nx];
            votes.set(v, (votes.get(v) ?? 0) + 1);
          }
        }
        let bestId = cur[y][x], bestCnt = 0;
        for (const [id, cnt] of votes) {
          if (cnt > bestCnt) { bestCnt = cnt; bestId = id; }
        }
        next[y][x] = bestId;
      }
    }
    cur = next;
  }
  return cur;
}

// ─── 输入解析 ────────────────────────────────────────────────────────────────

/** 把 point2d 列表输入规整为 {x,y}[]（取整、去越界、去无效）。 */
function parsePoints(raw: unknown, w: number, h: number): Point[] {
  const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: Point[] = [];
  for (const p of arr) {
    if (!p || typeof p !== 'object') continue;
    const px = (p as { x?: unknown }).x;
    const py = (p as { y?: unknown }).y;
    if (typeof px !== 'number' || typeof py !== 'number') continue;
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const x = Math.round(px), y = Math.round(py);
    if (x < 0 || x >= w || y < 0 || y >= h) continue;
    out.push({ x, y });
  }
  return out;
}

/** 把 islandSizes 列表输入规整为 number[]；空则回退默认 [12]。 */
function parseSizes(raw: unknown): number[] {
  const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: number[] = [];
  for (const v of arr) {
    const n = Number(v);
    if (Number.isFinite(n)) out.push(Math.max(3, n));
  }
  return out.length > 0 ? out : [12];
}

// ─── 主导出函数 ──────────────────────────────────────────────────────────────

export function newIslandRegionGen(
  input: Record<string, unknown>
): Record<string, unknown> {
  const rawGrid = input.grid as number[][] | undefined;
  if (!Array.isArray(rawGrid) || rawGrid.length === 0 || !Array.isArray(rawGrid[0])) {
    return { islandGrid: [], waterGrid: [], regionGrid: [], error: 'grid is required and must be a non-empty number[][]' };
  }
  const h = rawGrid.length;
  const w = rawGrid[0].length;
  const mask = rawGrid;

  const points = parsePoints(input.points, w, h);
  if (points.length === 0) {
    // 没有有效锚点：整图皆水，返回与 grid 同形的全 0 陆地 / 全 1 水面。
    const islandGrid = Array.from({ length: h }, () => new Array(w).fill(0));
    const waterGrid = islandGrid.map(row => row.map(v => 1 - v));
    return { islandGrid, waterGrid, regionGrid: islandGrid.map(row => [...row]), error: 'no valid points (anchors) provided' };
  }

  const islandSizes = parseSizes(input.islandSizes);
  const radiusVar = typeof input.radiusVar === 'number' ? Math.min(0.8, Math.max(0, input.radiusVar)) : 0.3;

  const seedRaw = typeof input.seed === 'number' ? Math.round(input.seed) : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const rng = new LCG(baseSeed);
  const noiseSeed = Math.round(rng.float64() * 99991);

  // 每个锚点（point）衍生一岛；岛大小取 islandSizes[i]，不足时复用最后一个。
  const allSeeds: SubSeed[] = [];
  let minSize = Infinity, maxSize = 0;
  for (let i = 0; i < points.length; i++) {
    const size = islandSizes[Math.min(i, islandSizes.length - 1)];
    minSize = Math.min(minSize, size);
    maxSize = Math.max(maxSize, size);
    const subSeeds = Math.max(2, Math.round(size / 3));
    const subSpacing = Math.max(2, size * 0.4);
    const sub = placeSubSeeds(points[i], i + 1, w, h, mask, subSeeds, size, radiusVar, subSpacing, rng);
    allSeeds.push(...sub);
  }

  // 竞争 BFS 膨胀
  let regionGrid = competitiveGrow(w, h, mask, allSeeds, noiseSeed, rng);

  // 去除小碎片（按最小岛尺寸派生阈值，避免误删小岛）
  const minArea = Math.max(4, Math.round(minSize * minSize * 0.1));
  regionGrid = removeSmallIslands(regionGrid, w, h, minArea);

  // 边界平滑（多数投票，半径按最大岛尺寸派生，迭代 2 次）
  const smoothRadius = Math.max(1, Math.round(maxSize * 0.08));
  regionGrid = majoritySmooth(regionGrid, w, h, smoothRadius, 2);
  // 平滑后再次清理因平滑产生的小碎片
  regionGrid = removeSmallIslands(regionGrid, w, h, minArea);

  // 合并为二值掩码
  const islandGrid = regionGrid.map(row => row.map(v => (v > 0 ? 1 : 0)));
  const waterGrid = islandGrid.map(row => row.map(v => 1 - v));

  return { islandGrid, waterGrid, regionGrid };
}
