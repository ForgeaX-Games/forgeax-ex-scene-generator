/**
 * cosmos_zone_marker: 使用Voronoi噪声在地形网格上标记特殊区域（结构/水晶/远古）
 * 输入：terrainGrid (array/grid) — 地形类型网格，兼容单张或列表
 *        seed — 随机种子
 *        zoneDensity — 区域块数密度，越大块数越多（默认1.0）
 *        structureZoneSize / crystalZoneSize / ancientZoneSize — 各区域面积阈值（0~0.5）
 * 输出：zoneGridList — 多张单值网格，与nameList一一对应
 *        nameList — 实际出现的区域条目
 *
 * 区域定义：100=结构区域，200=水晶区域，300=远古区域
 */

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 每次调用按 seed 派生一份全新的置换表，不复用/不缓存跨调用状态——
 * 之前版本用模块级 perm/noiseReady/lastSeed 缓存，同进程内并发跑不同 seed
 * 的两次调用会相互踩踏彼此的置换表（数据竞争），违反节点独立性假设。
 * 代价是同 seed 重复调用会重算 256 项洗牌，量级上可忽略。
 */
function buildPermTable(seed: number): Uint8Array {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  const rng = mulberry32(seed);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

function grad2(index: number): [number, number] {
  const g = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
  return g[index % 8] as [number, number];
}

function noise2D(perm: Uint8Array, x: number, y: number): number {
  const s = (x + y) * F2;
  const i = Math.floor(x + s);
  const j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t);
  const y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  const g0 = grad2(perm[ii + perm[jj]] % 8);
  const g1 = grad2(perm[ii + i1 + perm[jj + j1]] % 8);
  const g2v = grad2(perm[ii + 1 + perm[jj + 1]] % 8);
  let n0 = 0, n1 = 0, n2 = 0;
  let t0 = 0.5 - x0*x0 - y0*y0; if (t0 >= 0) { t0 *= t0; n0 = t0*t0*(g0[0]*x0+g0[1]*y0); }
  let t1 = 0.5 - x1*x1 - y1*y1; if (t1 >= 0) { t1 *= t1; n1 = t1*t1*(g1[0]*x1+g1[1]*y1); }
  let t2 = 0.5 - x2*x2 - y2*y2; if (t2 >= 0) { t2 *= t2; n2 = t2*t2*(g2v[0]*x2+g2v[1]*y2); }
  return 70 * (n0 + n1 + n2);
}

/** Voronoi：返回到最近特征点的距离 [0,1]，scale 控制特征点密度 */
function voronoi(perm: Uint8Array, x: number, y: number, scale: number): number {
  const sx = x * scale, sy = y * scale;
  const ix = Math.floor(sx), iy = Math.floor(sy);
  let minDist = 999;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const cx = ix + dx, cy = iy + dy;
      const px = cx + (noise2D(perm, cx * 12.9898, cy * 78.233) + 1) * 0.5;
      const py = cy + (noise2D(perm, cx * 93.9898, cy * 67.345) + 1) * 0.5;
      const dist = Math.sqrt((sx - px) ** 2 + (sy - py) ** 2);
      minDist = Math.min(minDist, dist);
    }
  }
  return Math.min(minDist, 1);
}

export function cosmosZoneMarker(input: Record<string, unknown>): Record<string, unknown> {
  // 兼容 array 输入（variedGridList），自动合并为单张网格
  let terrainGrid = input.terrainGrid as number[][] | number[][][] | undefined;
  if (Array.isArray(terrainGrid) && terrainGrid.length > 0 && Array.isArray(terrainGrid[0]) && Array.isArray((terrainGrid[0] as number[][])[0])) {
    const layers = terrainGrid as number[][][];
    const H = layers[0].length, W = layers[0][0]?.length ?? 0;
    const merged: number[][] = Array.from({ length: H }, () => new Array(W).fill(0));
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        for (const layer of layers) { const v = layer[y]?.[x] ?? 0; if (v !== 0) { merged[y][x] = v; break; } }
    terrainGrid = merged;
  }

  if (!terrainGrid || (terrainGrid as number[][]).length === 0) {
    return { error: "terrainGrid is required" };
  }
  const grid = terrainGrid as number[][];

  const seedRaw = typeof input.seed === "number" ? input.seed : 0;

  // zoneDensity：区域块数密度，控制 Voronoi 特征点的疏密
  //   越大 → 特征点越多 → 区域块数越多（每块大小由各 ZoneSize 阈值单独控制，不受此影响）
  const zoneDensity = typeof input.zoneDensity === "number" ? Math.max(0.1, input.zoneDensity) : 0.38;
  // 基准 scale=0.05 对应200×200地图约100块区域；zoneDensity 线性缩放块数
  const baseScale = 0.05;

  // *ZoneSize：面积阈值，控制每块区域大小，与 zoneDensity 无关
  const structureZoneSize = typeof input.structureZoneSize === "number" ? input.structureZoneSize : 0.08;
  const crystalZoneSize   = typeof input.crystalZoneSize   === "number" ? input.crystalZoneSize   : 0.12;
  const ancientZoneSize   = typeof input.ancientZoneSize   === "number" ? input.ancientZoneSize   : 0.10;

  const seed = seedRaw === 0 ? Date.now() : seedRaw;
  const perm = buildPermTable(seed);

  const height = grid.length;
  const width = grid[0]?.length ?? 0;

  const structureGrid: number[][] = Array.from({ length: height }, () => new Array(width).fill(0));
  const crystalGrid: number[][] = Array.from({ length: height }, () => new Array(width).fill(0));
  const ancientGrid: number[][] = Array.from({ length: height }, () => new Array(width).fill(0));

  let hasStructure = false, hasCrystal = false, hasAncient = false;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x] === 0) continue;

      // 三种区域各自用独立坐标偏移，保证特征点位置不重叠
      // zoneDensity 只改变 scale（特征点密度），不影响阈值
      const structureNoise = voronoi(perm, x * baseScale * zoneDensity,       y * baseScale * zoneDensity,       1);
      const crystalNoise   = voronoi(perm, x * baseScale * zoneDensity + 100, y * baseScale * zoneDensity,       1);
      const ancientNoise   = voronoi(perm, x * baseScale * zoneDensity + 200, y * baseScale * zoneDensity + 200, 1);

      if (ancientNoise < ancientZoneSize) {
        ancientGrid[y][x] = 300;
        hasAncient = true;
      } else if (crystalNoise < crystalZoneSize) {
        crystalGrid[y][x] = 200;
        hasCrystal = true;
      } else if (structureNoise < structureZoneSize) {
        structureGrid[y][x] = 100;
        hasStructure = true;
      }
    }
  }

  const zoneGridList: number[][][] = [];
  const nameList: { id: number; name: string; type: string }[] = [];

  if (hasStructure) {
    zoneGridList.push(structureGrid);
    nameList.push({ id: 100, name: "结构区域", type: "asset" });
  }
  if (hasCrystal) {
    zoneGridList.push(crystalGrid);
    nameList.push({ id: 200, name: "水晶区域", type: "asset" });
  }
  if (hasAncient) {
    zoneGridList.push(ancientGrid);
    nameList.push({ id: 300, name: "远古区域", type: "asset" });
  }

  return { zoneGridList, nameList };
}
