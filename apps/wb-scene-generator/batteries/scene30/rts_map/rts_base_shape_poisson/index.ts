/**
 * rtsBaseShapePoisson: 泊松盘采样锚点 + 多子种子竞争膨胀算法
 *
 * 与 rtsBaseShapeGen 的区别：锚点不再按 L 形分区放置，
 * 而是用 Bridson 泊松盘采样在整个 mask 内均匀分布，保证锚点之间最小间距。
 *
 * 输出：
 *   baseGrid   — 与输入 grid 同尺寸，平台为 1，空地为 0
 *   regionGrid — 与输入 grid 同尺寸，各区域独立 ID（1-based），空地为 0
 */

// ─── LCG ─────────────────────────────────────────────────────────────────────

class LCG {
  private state: bigint;
  constructor(seed: number) {
    this.state = seed === 0 ? 12345n : BigInt(seed >>> 0);
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

// ─── 空间哈希噪声 ────────────────────────────────────────────────────────────

function hash2d(ix: number, iy: number, seed: number): number {
  let h = ((ix * 1619 + iy * 31337 + seed * 1013904223) | 0) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (((h * (h * h * 15731 + 789221) + 1376312589) | 0) >>> 0);
  return h / 4294967295;
}

// ─── 数据结构 ────────────────────────────────────────────────────────────────

interface SubSeed {
  x: number;
  y: number;
  maxR: number;
  regionId: number;
}

// ─── Bridson 泊松盘采样（限定在 mask 内）────────────────────────────────────
//
// 改编自 Bridson (2007) "Fast Poisson Disk Sampling in Arbitrary Dimensions"
// 核心思路：背景网格（cellSize = minDist/√2）加速近邻查询，
// 对每个活跃点生成 k 个候选（环形区域 [minDist, 2*minDist]），
// 候选点必须在 mask 内且与所有已有点距离 ≥ minDist。

function poissonDiskSample(
  w: number,
  h: number,
  mask: number[][],
  minDist: number,
  maxPoints: number,
  rng: LCG
): Array<{ x: number; y: number }> {
  const cellSize = minDist / Math.SQRT2;
  const gridW = Math.ceil(w / cellSize);
  const gridH = Math.ceil(h / cellSize);
  // 每个背景格子存储落在其中的所有点索引（修复：原先只存一个，同格点会互相覆盖）
  const bgGrid: number[][] = Array.from({ length: gridW * gridH }, () => []);
  const points: Array<{ x: number; y: number }> = [];
  const active: number[] = [];

  const bgCellIdx = (x: number, y: number) =>
    Math.floor(y / cellSize) * gridW + Math.floor(x / cellSize);

  const addPoint = (x: number, y: number) => {
    const idx = points.length;
    points.push({ x, y });
    bgGrid[bgCellIdx(x, y)].push(idx);
    active.push(idx);
  };

  // 在 mask 内找第一个随机起点（最多尝试 2000 次）
  let found = false;
  for (let t = 0; t < 2000 && !found; t++) {
    const sx = Math.floor(rng.float64() * w);
    const sy = Math.floor(rng.float64() * h);
    if (mask[sy]?.[sx]) {
      addPoint(sx, sy);
      found = true;
    }
  }
  if (!found) return points;

  const k = 30; // 每次最多尝试候选数
  const minDistSq = minDist * minDist;

  while (active.length > 0 && points.length < maxPoints) {
    const activeIdx = Math.floor(rng.float64() * active.length);
    const pIdx = active[activeIdx];
    const p = points[pIdx];

    let accepted = false;
    for (let attempt = 0; attempt < k; attempt++) {
      const angle = rng.float64() * Math.PI * 2;
      const dist = minDist * (1 + rng.float64()); // [minDist, 2*minDist]
      const cx = Math.round(p.x + Math.cos(angle) * dist);
      const cy = Math.round(p.y + Math.sin(angle) * dist);

      if (cx < 0 || cx >= w || cy < 0 || cy >= h) continue;
      if (!mask[cy]?.[cx]) continue;

      // 检查背景网格中周围 5x5 格子内是否有点太近
      const gcx = Math.floor(cx / cellSize);
      const gcy = Math.floor(cy / cellSize);
      let tooClose = false;
      outer: for (let gy = Math.max(0, gcy - 2); gy <= Math.min(gridH - 1, gcy + 2); gy++) {
        for (let gx = Math.max(0, gcx - 2); gx <= Math.min(gridW - 1, gcx + 2); gx++) {
          for (const nIdx of bgGrid[gy * gridW + gx]) {
            const np = points[nIdx];
            const ddx = cx - np.x, ddy = cy - np.y;
            if (ddx * ddx + ddy * ddy < minDistSq) { tooClose = true; break outer; }
          }
        }
      }
      if (tooClose) continue;

      addPoint(cx, cy);
      accepted = true;
      if (points.length >= maxPoints) break;
    }

    if (!accepted) {
      active.splice(activeIdx, 1);
    }
  }

  return points;
}

// ─── 子种子放置（围绕泊松锚点）──────────────────────────────────────────────

function placeSubSeeds(
  anchorX: number,
  anchorY: number,
  regionId: number,
  w: number,
  h: number,
  mask: number[][],
  subSeedsPerRegion: number,
  maxRadius: number,
  radiusVar: number,
  subSpacing: number,
  rng: LCG
): SubSeed[] {
  const regionSeeds: SubSeed[] = [];
  const r0 = maxRadius * (1 - radiusVar + rng.float64() * radiusVar * 2);
  regionSeeds.push({ x: anchorX, y: anchorY, maxR: Math.max(4, r0), regionId });

  const maxAttempts = subSeedsPerRegion * 80;
  for (let a = 0; a < maxAttempts && regionSeeds.length < subSeedsPerRegion; a++) {
    const angle = rng.float64() * Math.PI * 2;
    const dist = subSpacing * 0.5 + rng.float64() * subSpacing * 1.0;
    let sx = Math.round(anchorX + Math.cos(angle) * dist);
    let sy = Math.round(anchorY + Math.sin(angle) * dist);

    sx = Math.max(0, Math.min(w - 1, sx));
    sy = Math.max(0, Math.min(h - 1, sy));

    if (!mask[sy]?.[sx]) continue;

    let tooClose = false;
    for (const s of regionSeeds) {
      const dx = sx - s.x, dy = sy - s.y;
      if (dx * dx + dy * dy < subSpacing * subSpacing * 0.6) { tooClose = true; break; }
    }
    if (tooClose) continue;

    const r = maxRadius * (0.6 + rng.float64() * 0.6);
    regionSeeds.push({ x: sx, y: sy, maxR: Math.max(4, r), regionId });
  }

  return regionSeeds;
}

// ─── 竞争 BFS 膨胀（同区域融合 + 跨区域斥力，限定在 mask 内）────────────────

function competitiveGrow(
  w: number,
  h: number,
  mask: number[][],
  seeds: SubSeed[],
  gapWidth: number,
  growProb: number,
  noiseAmp: number,
  noiseSeed: number,
  rng: LCG
): number[][] {
  const region: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));
  const queue: Array<[number, number, number]> = [];
  let head = 0;

  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    if (s.x >= 0 && s.x < w && s.y >= 0 && s.y < h && mask[s.y][s.x]) {
      region[s.y][s.x] = s.regionId;
      queue.push([s.x, s.y, i]);
    }
  }

  const dirs: Array<[number, number]> = [
    [-1, -1], [0, -1], [1, -1],
    [-1,  0],          [1,  0],
    [-1,  1], [0,  1], [1,  1],
  ];

  const retryCount = new Map<string, number>();
  const maxRetry = 2;

  while (head < queue.length) {
    const [cx, cy, si] = queue[head++];
    const seed = seeds[si];
    const myRegion = seed.regionId;

    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.abs(Number(rng.next() % BigInt(i + 1)));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }

    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      if (!mask[ny][nx]) continue;

      const existing = region[ny][nx];
      if (existing === myRegion || existing !== 0) continue;

      const ddx = nx - seed.x, ddy = ny - seed.y;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy);
      if (dist > seed.maxR) continue;

      // 斥力间隙检查
      let tooCloseToOther = false;
      const gw = Math.ceil(gapWidth);
      for (let gy = -gw; gy <= gw && !tooCloseToOther; gy++) {
        for (let gx = -gw; gx <= gw && !tooCloseToOther; gx++) {
          if (gx === 0 && gy === 0) continue;
          const px = nx + gx, py = ny + gy;
          if (px < 0 || px >= w || py < 0 || py >= h) continue;
          const nr = region[py][px];
          if (nr !== 0 && nr !== myRegion) {
            if (Math.sqrt(gx * gx + gy * gy) <= gapWidth) tooCloseToOther = true;
          }
        }
      }
      if (tooCloseToOther) continue;

      const distFactor = 1 - (dist / seed.maxR);
      const noise = hash2d(nx, ny, noiseSeed) * 2 - 1;
      const prob = growProb * distFactor + noise * noiseAmp;

      if (rng.float64() < prob) {
        region[ny][nx] = myRegion;
        queue.push([nx, ny, si]);
      } else {
        const key = `${nx},${ny}`;
        const cnt = retryCount.get(key) ?? 0;
        if (cnt < maxRetry) {
          retryCount.set(key, cnt + 1);
          queue.push([cx, cy, si]);
        }
      }
    }
  }

  return region;
}

// ─── 清除小碎片 ──────────────────────────────────────────────────────────────

function removeSmallFragments(
  region: number[][], w: number, h: number, minArea: number
): number[][] {
  const result = region.map(row => [...row]);
  const visited = Array.from({ length: h }, () => new Uint8Array(w));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (result[y][x] === 0 || visited[y][x]) continue;
      const rid = result[y][x];
      const cells: Array<[number, number]> = [];
      const q: Array<[number, number]> = [[x, y]];
      visited[y][x] = 1;
      while (q.length > 0) {
        const [cx, cy] = q.shift()!;
        cells.push([cx, cy]);
        for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h &&
              result[ny][nx] === rid && !visited[ny][nx]) {
            visited[ny][nx] = 1;
            q.push([nx, ny]);
          }
        }
      }
      if (cells.length < minArea) {
        for (const [cx, cy] of cells) result[cy][cx] = 0;
      }
    }
  }
  return result;
}

// ─── 每个区域保留最大连通分量 ────────────────────────────────────────────────

function keepLargestPerRegion(
  region: number[][], w: number, h: number, numRegions: number
): number[][] {
  const result = region.map(row => [...row]);
  for (let rid = 1; rid <= numRegions; rid++) {
    const visited = Array.from({ length: h }, () => new Uint8Array(w));
    let bestCells: Array<[number, number]> = [];
    const allCells: Array<Array<[number, number]>> = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (result[y][x] !== rid || visited[y][x]) continue;
        const cells: Array<[number, number]> = [];
        const q: Array<[number, number]> = [[x, y]];
        visited[y][x] = 1;
        while (q.length > 0) {
          const [cx, cy] = q.shift()!;
          cells.push([cx, cy]);
          for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
            const nx = cx + dx, ny = cy + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h &&
                result[ny][nx] === rid && !visited[ny][nx]) {
              visited[ny][nx] = 1;
              q.push([nx, ny]);
            }
          }
        }
        allCells.push(cells);
        if (cells.length > bestCells.length) bestCells = cells;
      }
    }
    for (const cells of allCells) {
      if (cells !== bestCells) {
        for (const [cx, cy] of cells) result[cy][cx] = 0;
      }
    }
  }
  return result;
}

// ─── 主生成函数 ──────────────────────────────────────────────────────────────

function generateBaseShapePoisson(
  mask: number[][],
  maxRegions: number,
  minDist: number,
  subSeedsPerRegion: number,
  maxRadius: number,
  radiusVar: number,
  gapWidth: number,
  growProb: number,
  noiseAmp: number,
  subSpacing: number,
  seed: number
): { baseGrid: number[][]; regionGrid: number[][] } {
  const h = mask.length;
  const w = mask[0].length;
  const rng = new LCG(seed);
  const noiseSeed = Math.round(rng.float64() * 999983);

  // 泊松盘采样得到锚点
  const anchors = poissonDiskSample(w, h, mask, minDist, maxRegions, rng);

  // 为每个锚点生成子种子
  const allSeeds: SubSeed[] = [];
  for (let ri = 0; ri < anchors.length; ri++) {
    const { x, y } = anchors[ri];
    const regionId = ri + 1;
    const subSeeds = placeSubSeeds(
      x, y, regionId, w, h, mask,
      subSeedsPerRegion, maxRadius, radiusVar, subSpacing, rng
    );
    allSeeds.push(...subSeeds);
  }

  const numRegions = anchors.length;
  let region = competitiveGrow(w, h, mask, allSeeds, gapWidth, growProb, noiseAmp, noiseSeed, rng);
  region = keepLargestPerRegion(region, w, h, numRegions);
  region = removeSmallFragments(region, w, h, 8);

  const baseGrid = region.map(row => row.map(v => (v > 0 ? 1 : 0)));
  return { baseGrid, regionGrid: region };
}

// ─── 导出入口 ────────────────────────────────────────────────────────────────

export function rtsBaseShapePoisson(
  input: Record<string, unknown>
): Record<string, unknown> {
  const rawGrid = input.grid;
  if (!Array.isArray(rawGrid) || rawGrid.length === 0 || !Array.isArray(rawGrid[0])) {
    return { baseGrid: [], regionGrid: [] };
  }
  const mask = rawGrid as number[][];
  const h = mask.length;
  const w = mask[0].length;

  const maxRegions =
    typeof input.maxRegions === "number" ? Math.max(1, Math.round(input.maxRegions)) : 6;
  // minDist=0 视为"自动"，自动计算为 min(w,h)*0.25；否则使用用户指定值（最小 4）
  const minDistRaw = typeof input.minDist === "number" ? input.minDist : 0;
  const minDist = minDistRaw <= 0 ? Math.min(w, h) * 0.25 : Math.max(4, minDistRaw);
  const subSeeds =
    typeof input.subSeeds === "number" ? Math.max(1, Math.round(input.subSeeds)) : 4;
  const maxRadius =
    typeof input.maxRadius === "number" ? Math.max(3, input.maxRadius) : 16;
  const radiusVariance =
    typeof input.radiusVariance === "number"
      ? Math.min(0.8, Math.max(0, input.radiusVariance))
      : 0.25;
  const gapWidth =
    typeof input.gapWidth === "number" ? Math.max(0, input.gapWidth) : 3;
  const growProb =
    typeof input.growProb === "number"
      ? Math.min(1, Math.max(0.1, input.growProb))
      : 0.88;
  const noiseAmp =
    typeof input.noiseAmp === "number"
      ? Math.min(0.5, Math.max(0, input.noiseAmp))
      : 0.12;
  const subSpacing =
    typeof input.subSpacing === "number" ? Math.max(2, input.subSpacing) : 6;
  const seedRaw =
    typeof input.seed === "number" ? Math.round(input.seed) : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;

  const { baseGrid, regionGrid } = generateBaseShapePoisson(
    mask, maxRegions, minDist,
    subSeeds, maxRadius, radiusVariance,
    gapWidth, growProb, noiseAmp, subSpacing,
    baseSeed
  );

  return { baseGrid, regionGrid };
}
