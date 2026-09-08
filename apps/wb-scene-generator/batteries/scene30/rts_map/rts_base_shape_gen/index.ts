/**
 * rtsBaseShapeGen: 多子种子竞争膨胀算法（在输入网格掩码内生成）
 *
 * 输入一个 grid 掩码，在掩码非零区域内生成 SC2 风格的基地 blob。
 * 每个区域由 subSeeds 个子种子同团融合膨胀 → 多叶有机 blob
 * 不同区域之间通过 gapWidth 斥力保持间隙 → 独立不融合
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

interface Zone {
  x0: number; x1: number;
  y0: number; y1: number;
}

// ─── 分段放置主种子 + 子种子（限定在 mask 内） ──────────────────────────────

function placeAllSeeds(
  w: number, h: number,
  mask: number[][],
  numRegions: number,
  subSeedsPerRegion: number,
  maxRadius: number,
  radiusVar: number,
  subSpacing: number,
  rng: LCG
): SubSeed[] {
  const bw = Math.min(maxRadius * 0.8, w * 0.4);
  const splitX = w * 0.4;
  const splitY = h * 0.4;

  const zones: Zone[] = [];
  if (numRegions >= 1) zones.push({ x0: 0, x1: splitX, y0: 0, y1: splitY });
  if (numRegions >= 2) zones.push({ x0: splitX, x1: w - 1, y0: 0, y1: bw });
  if (numRegions >= 3) zones.push({ x0: 0, x1: bw, y0: splitY, y1: h - 1 });
  for (let i = 3; i < numRegions; i++) {
    zones.push(i % 2 === 1
      ? { x0: splitX, x1: w - 1, y0: 0, y1: bw }
      : { x0: 0, x1: bw, y0: splitY, y1: h - 1 }
    );
  }

  const allSeeds: SubSeed[] = [];

  for (let ri = 0; ri < zones.length; ri++) {
    const zone = zones[ri];
    const regionId = ri + 1;
    const zoneW = zone.x1 - zone.x0;
    const zoneH = zone.y1 - zone.y0;

    // 先找主锚点（在 mask 内采样）
    let anchorX = -1, anchorY = -1;
    for (let a = 0; a < 300; a++) {
      const tx = Math.round(zone.x0 + zoneW * (0.3 + rng.float64() * 0.4));
      const ty = Math.round(zone.y0 + zoneH * (0.3 + rng.float64() * 0.4));
      if (tx >= 0 && tx < w && ty >= 0 && ty < h && mask[ty][tx] !== 0) {
        anchorX = tx; anchorY = ty; break;
      }
    }
    // mask 内找不到则跳过此区域
    if (anchorX < 0) continue;

    const regionSeeds: SubSeed[] = [];
    const r0 = maxRadius * (1 - radiusVar + rng.float64() * radiusVar * 2);
    regionSeeds.push({ x: anchorX, y: anchorY, maxR: Math.max(4, r0), regionId });

    // 子种子在锚点周围放置，也必须在 mask 内
    const maxAttempts = subSeedsPerRegion * 80;
    for (let a = 0; a < maxAttempts && regionSeeds.length < subSeedsPerRegion; a++) {
      const angle = rng.float64() * Math.PI * 2;
      const dist = subSpacing * 0.5 + rng.float64() * subSpacing * 1.0;
      let sx = Math.round(anchorX + Math.cos(angle) * dist);
      let sy = Math.round(anchorY + Math.sin(angle) * dist);

      if (sx < 0) sx = 0; if (sy < 0) sy = 0;
      if (sx >= w) sx = w - 1; if (sy >= h) sy = h - 1;

      if (mask[sy][sx] === 0) continue; // 子种子必须在 mask 内

      let ok = true;
      for (const s of regionSeeds) {
        const dx = sx - s.x, dy = sy - s.y;
        if (dx * dx + dy * dy < subSpacing * subSpacing * 0.6) { ok = false; break; }
      }
      if (ok) {
        const r = maxRadius * (0.6 + rng.float64() * 0.6);
        regionSeeds.push({ x: sx, y: sy, maxR: Math.max(4, r), regionId });
      }
    }

    allSeeds.push(...regionSeeds);
  }

  return allSeeds;
}

// ─── 竞争 BFS 膨胀（同区域融合 + 跨区域斥力，限定在 mask 内）────────────────

function competitiveGrow(
  w: number, h: number,
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
    if (s.x >= 0 && s.x < w && s.y >= 0 && s.y < h && mask[s.y][s.x] !== 0) {
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
      if (mask[ny][nx] === 0) continue; // 不能生长到 mask 外

      const existing = region[ny][nx];
      if (existing === myRegion) continue;
      if (existing !== 0) continue;

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

function generateBaseShape(
  mask: number[][],
  numRegions: number,
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

  const seeds = placeAllSeeds(
    w, h, mask, numRegions, subSeedsPerRegion,
    maxRadius, radiusVar, subSpacing, rng
  );

  let region = competitiveGrow(w, h, mask, seeds, gapWidth, growProb, noiseAmp, noiseSeed, rng);
  region = keepLargestPerRegion(region, w, h, numRegions);
  region = removeSmallFragments(region, w, h, 8);

  const baseGrid = region.map(row => row.map(v => (v > 0 ? 1 : 0)));
  return { baseGrid, regionGrid: region };
}

// ─── 导出入口 ────────────────────────────────────────────────────────────────

export function rtsBaseShapeGen(
  input: Record<string, unknown>
): Record<string, unknown> {
  // 解析输入 grid（掩码）
  const rawGrid = input.grid;
  if (!Array.isArray(rawGrid) || rawGrid.length === 0 || !Array.isArray(rawGrid[0])) {
    return { baseGrid: [], regionGrid: [] };
  }
  const mask = rawGrid as number[][];

  const numSeeds =
    typeof input.numSeeds === "number" ? Math.max(1, Math.round(input.numSeeds)) : 3;
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

  const { baseGrid, regionGrid } = generateBaseShape(
    mask, numSeeds, subSeeds,
    maxRadius, radiusVariance,
    gapWidth, growProb, noiseAmp, subSpacing,
    baseSeed
  );

  return { baseGrid, regionGrid };
}
