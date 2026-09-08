/**
 * islandPoissonGen: 泊松盘 + 竞争 BFS 膨胀岛屿生成
 *
 * 输入一个网格（作为可生成区域掩码），在掩码范围内均匀放置岛屿并膨胀生长。
 * 1. Bridson 泊松盘采样 → 在掩码内均匀放置锚点（保证最小间距）
 * 2. 每个锚点衍生多个子种子 → 形成多叶有机 blob 形状
 * 3. 竞争 BFS 膨胀 → 各岛屿独立生长，自动保持间距
 * 4. 输出 islandGrid（陆地）+ waterGrid（水面）
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

// ─── Bridson 泊松盘采样（限定在掩码内）──────────────────────────────────────

interface Point { x: number; y: number }

function poissonDiskSample(
  w: number, h: number,
  mask: number[][],
  minDist: number, maxPoints: number,
  rng: LCG
): Point[] {
  const cellSize = minDist / Math.SQRT2;
  const gridW = Math.ceil(w / cellSize);
  const gridH = Math.ceil(h / cellSize);
  const bgGrid: number[][] = Array.from({ length: gridW * gridH }, () => []);
  const points: Point[] = [];
  const active: number[] = [];
  const minDistSq = minDist * minDist;

  const bgIdx = (x: number, y: number) =>
    Math.floor(y / cellSize) * gridW + Math.floor(x / cellSize);

  const inMask = (x: number, y: number) =>
    x >= 0 && x < w && y >= 0 && y < h && mask[y][x] !== 0;

  const addPoint = (x: number, y: number) => {
    const idx = points.length;
    points.push({ x, y });
    bgGrid[bgIdx(x, y)].push(idx);
    active.push(idx);
  };

  // 随机起点（限定在掩码内）
  let tries = 0;
  while (tries < 1000) {
    const sx = Math.floor(rng.float64() * w);
    const sy = Math.floor(rng.float64() * h);
    if (inMask(sx, sy)) { addPoint(sx, sy); break; }
    tries++;
  }
  if (points.length === 0) return points;

  while (active.length > 0 && points.length < maxPoints) {
    const ai = Math.floor(rng.float64() * active.length);
    const p = points[active[ai]];
    let accepted = false;

    for (let k = 0; k < 30; k++) {
      const angle = rng.float64() * Math.PI * 2;
      const dist = minDist * (1 + rng.float64());
      const cx = Math.round(p.x + Math.cos(angle) * dist);
      const cy = Math.round(p.y + Math.sin(angle) * dist);
      if (!inMask(cx, cy)) continue;

      const gcx = Math.floor(cx / cellSize);
      const gcy = Math.floor(cy / cellSize);
      let tooClose = false;
      outer: for (
        let gy = Math.max(0, gcy - 2);
        gy <= Math.min(gridH - 1, gcy + 2);
        gy++
      ) {
        for (
          let gx = Math.max(0, gcx - 2);
          gx <= Math.min(gridW - 1, gcx + 2);
          gx++
        ) {
          for (const ni of bgGrid[gy * gridW + gx]) {
            const np = points[ni];
            const ddx = cx - np.x, ddy = cy - np.y;
            if (ddx * ddx + ddy * ddy < minDistSq) {
              tooClose = true;
              break outer;
            }
          }
        }
      }
      if (tooClose) continue;

      addPoint(cx, cy);
      accepted = true;
      if (points.length >= maxPoints) break;
    }
    if (!accepted) active.splice(ai, 1);
  }
  return points;
}

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

// ─── 主导出函数 ──────────────────────────────────────────────────────────────

export function islandPoissonGen(
  input: Record<string, unknown>
): Record<string, unknown> {
  // 从输入网格取宽高和掩码
  const rawGrid = input.grid as number[][] | undefined;
  const h = rawGrid ? rawGrid.length : 80;
  const w = rawGrid && rawGrid[0] ? rawGrid[0].length : 80;
  // 无输入网格时，全图均可放置
  const mask: number[][] = rawGrid
    ? rawGrid
    : Array.from({ length: h }, () => new Array(w).fill(1));

  const numIslands = typeof input.numIslands === "number" ? Math.max(1, Math.round(input.numIslands)) : 8;
  const islandSize  = typeof input.islandSize === "number"  ? Math.max(3, input.islandSize)  : 12;
  const radiusVar   = typeof input.radiusVar  === "number"  ? Math.min(0.8, Math.max(0, input.radiusVar)) : 0.3;

  const seedRaw  = typeof input.seed === "number" ? Math.round(input.seed) : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const rng      = new LCG(baseSeed);
  const noiseSeed = Math.round(rng.float64() * 99991);

  // 锚点最小间距：保证采样时均匀分布，膨胀阶段不限制边界碰撞
  const minDist = islandSize * 2.0;
  // 子种子数量和间距跟随岛屿大小
  const subSeeds   = Math.max(2, Math.round(islandSize / 3));
  const subSpacing = Math.max(2, islandSize * 0.4);

  // 泊松盘采样
  const anchors = poissonDiskSample(w, h, mask, minDist, numIslands, rng);

  // 子种子散布
  const allSeeds: SubSeed[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const sub = placeSubSeeds(
      anchors[i], i + 1, w, h, mask,
      subSeeds, islandSize, radiusVar, subSpacing, rng
    );
    allSeeds.push(...sub);
  }

  // 竞争 BFS 膨胀
  let regionGrid = competitiveGrow(w, h, mask, allSeeds, noiseSeed, rng);

  // 去除小碎片
  const minArea = Math.max(4, Math.round(islandSize * islandSize * 0.1));
  regionGrid = removeSmallIslands(regionGrid, w, h, minArea);

  // 边界平滑（多数投票，半径1 迭代2次，消除锯齿但保留多叶形态）
  const smoothRadius = Math.max(1, Math.round(islandSize * 0.08));
  regionGrid = majoritySmooth(regionGrid, w, h, smoothRadius, 2);
  // 平滑后再次清理因平滑产生的小碎片
  regionGrid = removeSmallIslands(regionGrid, w, h, minArea);

  // 合并为二值掩码
  const islandGrid = regionGrid.map(row => row.map(v => (v > 0 ? 1 : 0)));
  const waterGrid  = islandGrid.map(row => row.map(v => 1 - v));

  return { islandGrid, waterGrid, regionGrid };
}
