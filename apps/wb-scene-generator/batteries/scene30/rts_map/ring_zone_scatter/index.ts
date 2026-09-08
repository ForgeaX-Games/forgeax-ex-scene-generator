/**
 * ringZoneScatter: 沿网格四周边界均匀放置 N 个锚点，每个区域从边界向内竞争 BFS 膨胀
 *
 * 算法：
 *   1. 把四条边的所有像素按"沿周长的距离"参数化，均匀取 N 个锚点
 *   2. 每个锚点在紧贴边界处放置，再沿边界切线方向散布 subSeeds 个子种子
 *   3. 竞争 BFS：同区域融合，跨区域斥力 gapWidth，向内深度限制 maxDepth
 *   4. 保留每区域最大连通分量，计算质心输出
 *
 * 输入：grid, zoneCount, maxDepth, subSeeds, gapWidth, growProb, noiseAmp, angleOffset, seed
 * 输出：baseGrid, regionGrid, zoneCenters
 */

// ─── LCG 随机数 ───────────────────────────────────────────────────────────────

class LCG {
  private s: bigint;
  constructor(seed: number) {
    this.s = seed === 0 ? 12345n : BigInt(seed >>> 0);
  }
  next(): bigint {
    this.s = (this.s * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
    return this.s;
  }
  float(): number {
    return Number(this.next() & 0xffffffffn) / 0xffffffff;
  }
}

// ─── 空间哈希噪声 ────────────────────────────────────────────────────────────

function hash2d(x: number, y: number, seed: number): number {
  let h = ((x * 1619 + y * 31337 + seed * 1013904223) | 0) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (((h * (h * h * 15731 + 789221) + 1376312589) | 0) >>> 0);
  return h / 4294967295;
}

// ─── 沿四边周长参数化，均匀采样 N 个边界锚点 ─────────────────────────────────
//
// 周长顺序：上边(左→右) → 右边(上→下) → 下边(右→左) → 左边(下→上)
// 返回每个锚点的 {px, py}（紧贴边界的像素坐标）以及该点的"向内法线方向"

interface BorderAnchor {
  px: number;   // 锚点列
  py: number;   // 锚点行
  nx: number;   // 向内法线 dx（-1/0/1）
  ny: number;   // 向内法线 dy
}

function sampleBorderAnchors(
  w: number,
  h: number,
  count: number,
  angleOffsetDeg: number
): BorderAnchor[] {
  // 周长（像素数，去掉重复角点）
  const perimeter = 2 * (w + h) - 4;
  const offsetPx = Math.round((angleOffsetDeg / 360) * perimeter);

  const anchors: BorderAnchor[] = [];
  for (let i = 0; i < count; i++) {
    const raw = Math.round((i / count) * perimeter) + offsetPx;
    const p = ((raw % perimeter) + perimeter) % perimeter;

    let px: number, py: number, nx: number, ny: number;

    if (p < w) {
      // 上边：列 = p，行 = 0，向内朝下
      px = p; py = 0; nx = 0; ny = 1;
    } else if (p < w + h - 1) {
      // 右边：列 = w-1，行 = p-(w-1)
      px = w - 1; py = p - (w - 1); nx = -1; ny = 0;
    } else if (p < 2 * w + h - 2) {
      // 下边：列从右到左，行 = h-1
      px = (w - 1) - (p - (w + h - 2)); py = h - 1; nx = 0; ny = -1;
    } else {
      // 左边：列 = 0，行从下到上
      px = 0; py = (h - 1) - (p - (2 * w + h - 3)); nx = 1; ny = 0;
    }

    // 确保在网格内
    px = Math.max(0, Math.min(w - 1, px));
    py = Math.max(0, Math.min(h - 1, py));
    anchors.push({ px, py, nx, ny });
  }
  return anchors;
}

// ─── 生成所有子种子 ───────────────────────────────────────────────────────────

interface SubSeed {
  x: number;
  y: number;
  maxR: number;
  zoneId: number;
}

function buildSubSeeds(
  w: number,
  h: number,
  anchors: BorderAnchor[],
  subSeeds: number,
  maxDepth: number,
  rng: LCG
): SubSeed[] {
  const all: SubSeed[] = [];
  const subSpread = Math.max(3, maxDepth * 0.5);

  for (let zi = 0; zi < anchors.length; zi++) {
    const { px, py, nx, ny } = anchors[zi];
    const zoneId = zi + 1;
    const seeds: SubSeed[] = [];

    // 主锚点：稍微向内偏移 1 格，避免完全贴死最外层
    const mx = Math.max(0, Math.min(w - 1, px + nx));
    const my = Math.max(0, Math.min(h - 1, py + ny));
    seeds.push({ x: mx, y: my, maxR: maxDepth, zoneId });

    // 子种子：沿边界切线方向（法线的垂直方向）散布
    // 切线向量：若法线是 (nx,ny)，切线是 (ny, -nx) 或 (-ny, nx)
    const tx = ny;
    const ty = -nx;

    const maxAttempts = subSeeds * 80;
    for (let a = 0; a < maxAttempts && seeds.length < subSeeds; a++) {
      const along = (rng.float() * 2 - 1) * subSpread * 1.5;
      const inward = rng.float() * maxDepth * 0.4;
      const sx = Math.round(px + tx * along + nx * (1 + inward));
      const sy = Math.round(py + ty * along + ny * (1 + inward));

      if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;

      // 检查与已有子种子的最小间距
      let ok = true;
      for (const s of seeds) {
        const dx = sx - s.x, dy = sy - s.y;
        if (dx * dx + dy * dy < subSpread * subSpread * 0.4) { ok = false; break; }
      }
      if (!ok) continue;

      const r = maxDepth * (0.5 + rng.float() * 0.6);
      seeds.push({ x: sx, y: sy, maxR: Math.max(3, r), zoneId });
    }

    all.push(...seeds);
  }
  return all;
}

// ─── 竞争 BFS 膨胀（向内深度限制 + 斥力间隙） ────────────────────────────────

function competitiveGrow(
  w: number,
  h: number,
  seeds: SubSeed[],
  anchors: BorderAnchor[],
  maxDepth: number,
  gapWidth: number,
  growProb: number,
  noiseAmp: number,
  noiseSeed: number,
  rng: LCG
): number[][] {
  const region: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

  // 预计算每格到最近边缘的距离（近似：min距离四边）
  const edgeDist = (x: number, y: number) =>
    Math.min(x, y, w - 1 - x, h - 1 - y);

  const queue: Array<[number, number, number]> = [];
  let head = 0;

  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    if (s.x >= 0 && s.x < w && s.y >= 0 && s.y < h) {
      region[s.y][s.x] = s.zoneId;
      queue.push([s.x, s.y, i]);
    }
  }

  // 每个区域对应的锚点法线方向（用于深度计算）
  const anchorNormals = anchors.map(a => ({ nx: a.nx, ny: a.ny, px: a.px, py: a.py }));

  const dirs: Array<[number, number]> = [
    [-1, -1], [0, -1], [1, -1],
    [-1,  0],           [1,  0],
    [-1,  1], [0,  1], [1,  1],
  ];

  const retryCount = new Map<string, number>();

  while (head < queue.length) {
    const [cx, cy, si] = queue[head++];
    const seed = seeds[si];
    const myZone = seed.zoneId;
    const anchorIdx = myZone - 1;
    const { nx, ny, px, py } = anchorNormals[anchorIdx];

    // 随机打乱方向
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.abs(Number(rng.next() % BigInt(i + 1)));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }

    for (const [dx, dy] of dirs) {
      const nx2 = cx + dx;
      const ny2 = cy + dy;
      if (nx2 < 0 || nx2 >= w || ny2 < 0 || ny2 >= h) continue;

      const existing = region[ny2][nx2];
      if (existing === myZone) continue;
      if (existing !== 0) continue;

      // 深度检查：沿法线方向投影距离不超过 maxDepth
      // 向内距离 = (目标点 - 边界锚点) · 法线
      const inwardDist = (nx2 - px) * nx + (ny2 - py) * ny;
      if (inwardDist > maxDepth) continue;
      // 也不能跑到边界外侧（inwardDist < 0 表示在锚点外）
      if (inwardDist < -1) continue;

      // 到种子的距离限制
      const ddx = nx2 - seed.x, ddy = ny2 - seed.y;
      const distToSeed = Math.sqrt(ddx * ddx + ddy * ddy);
      if (distToSeed > seed.maxR) continue;

      // 也基于 edgeDist 限制（不能超过 maxDepth 格深）
      if (edgeDist(nx2, ny2) > maxDepth) continue;

      // 跨区域斥力
      let tooClose = false;
      const gw = Math.ceil(gapWidth);
      outer: for (let gy = -gw; gy <= gw; gy++) {
        for (let gx = -gw; gx <= gw; gx++) {
          if (gx === 0 && gy === 0) continue;
          const px2 = nx2 + gx, py2 = ny2 + gy;
          if (px2 < 0 || px2 >= w || py2 < 0 || py2 >= h) continue;
          const nr = region[py2][px2];
          if (nr !== 0 && nr !== myZone && Math.sqrt(gx * gx + gy * gy) <= gapWidth) {
            tooClose = true; break outer;
          }
        }
      }
      if (tooClose) continue;

      const distFactor = 1 - distToSeed / seed.maxR;
      const noise = hash2d(nx2, ny2, noiseSeed) * 2 - 1;
      const prob = growProb * distFactor + noise * noiseAmp;

      if (rng.float() < prob) {
        region[ny2][nx2] = myZone;
        queue.push([nx2, ny2, si]);
      } else {
        const key = `${nx2},${ny2}`;
        const cnt = retryCount.get(key) ?? 0;
        if (cnt < 2) {
          retryCount.set(key, cnt + 1);
          queue.push([cx, cy, si]);
        }
      }
    }
  }

  return region;
}

// ─── 保留每区域最大连通分量 ──────────────────────────────────────────────────

function keepLargest(region: number[][], w: number, h: number, zoneCount: number): number[][] {
  const result = region.map(r => [...r]);
  for (let zid = 1; zid <= zoneCount; zid++) {
    const visited = Array.from({ length: h }, () => new Uint8Array(w));
    let best: Array<[number, number]> = [];
    const comps: Array<Array<[number, number]>> = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (result[y][x] !== zid || visited[y][x]) continue;
        const cells: Array<[number, number]> = [];
        const q: Array<[number, number]> = [[x, y]];
        visited[y][x] = 1;
        while (q.length) {
          const [cx, cy] = q.shift()!;
          cells.push([cx, cy]);
          for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]] as const) {
            const nx = cx + dx, ny = cy + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h && result[ny][nx] === zid && !visited[ny][nx]) {
              visited[ny][nx] = 1; q.push([nx, ny]);
            }
          }
        }
        comps.push(cells);
        if (cells.length > best.length) best = cells;
      }
    }
    for (const c of comps) {
      if (c !== best) for (const [cx, cy] of c) result[cy][cx] = 0;
    }
  }
  return result;
}

// ─── 质心计算 ─────────────────────────────────────────────────────────────────

function zoneCentroids(
  region: number[][], w: number, h: number, zoneCount: number
): Array<{ x: number; y: number; id: number }> {
  const out: Array<{ x: number; y: number; id: number }> = [];
  for (let zid = 1; zid <= zoneCount; zid++) {
    let sx = 0, sy = 0, cnt = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (region[y][x] === zid) { sx += x; sy += y; cnt++; }
    if (cnt > 0) out.push({ x: Math.round(sx / cnt), y: Math.round(sy / cnt), id: zid });
  }
  return out;
}

// ─── 主导出 ───────────────────────────────────────────────────────────────────

export function ringZoneScatter(input: Record<string, unknown>): Record<string, unknown> {
  const rawGrid = input.grid;
  if (!Array.isArray(rawGrid) || rawGrid.length === 0 || !Array.isArray(rawGrid[0])) {
    return { error: "grid is required" };
  }
  const h = (rawGrid as unknown[][]).length;
  const w = (rawGrid as unknown[][])[0].length;
  const minDim = Math.min(w, h);

  const zoneCount   = typeof input.zoneCount  === "number" ? Math.max(1, Math.round(input.zoneCount)) : 4;
  const maxDepthRaw = typeof input.maxDepth   === "number" ? input.maxDepth : 0;
  const maxDepth    = maxDepthRaw > 0 ? Math.round(maxDepthRaw) : Math.round(minDim * 0.20);
  const subSeeds    = typeof input.subSeeds   === "number" ? Math.max(1, Math.round(input.subSeeds)) : 3;
  const gapWidth    = typeof input.gapWidth   === "number" ? Math.max(0, input.gapWidth) : 3;
  const growProb    = typeof input.growProb   === "number" ? Math.min(1, Math.max(0.1, input.growProb)) : 0.88;
  const noiseAmp    = typeof input.noiseAmp   === "number" ? Math.min(0.5, Math.max(0, input.noiseAmp)) : 0.15;
  const angleOffset = typeof input.angleOffset === "number" ? input.angleOffset : 45;
  const seedRaw     = typeof input.seed       === "number" ? Math.round(input.seed) : 0;
  const baseSeed    = seedRaw === 0 ? Date.now() : seedRaw;

  const rng = new LCG(baseSeed);
  const noiseSeed = Math.round(rng.float() * 999983);

  // 1. 沿四边均匀采样 N 个锚点
  const anchors = sampleBorderAnchors(w, h, zoneCount, angleOffset);

  // 2. 为每个锚点生成子种子
  const seeds = buildSubSeeds(w, h, anchors, subSeeds, maxDepth, rng);

  if (seeds.length === 0) {
    return { error: "No seeds placed. Try reducing gapWidth or increasing maxDepth." };
  }

  // 3. 竞争 BFS 膨胀
  let region = competitiveGrow(w, h, seeds, anchors, maxDepth, gapWidth, growProb, noiseAmp, noiseSeed, rng);

  // 4. 清理碎片
  region = keepLargest(region, w, h, zoneCount);

  const baseGrid   = region.map(row => row.map(v => v > 0 ? 1 : 0));
  const zoneCenters = zoneCentroids(region, w, h, zoneCount);

  return { baseGrid, regionGrid: region, zoneCenters };
}
