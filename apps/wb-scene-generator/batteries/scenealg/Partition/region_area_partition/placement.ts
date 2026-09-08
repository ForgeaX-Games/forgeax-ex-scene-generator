/**
 * placement.ts
 * 种子定位、配额感知 Voronoi 分配、Lloyd 松弛
 */

export interface RegionDef {
  name: string;
  area: number;    // 面积占比（0~1 浮点），表示占可用区域总像素的比例
  position: number; // 1-9 九宫格方位
}

export interface SeedPoint {
  x: number;
  y: number;
  regionIdx: number;
}

/** 每个种子的形状拉伸系数（水平/竖直），1=正圆，>1=沿该轴拉长。 */
export interface SeedShape {
  sx: number;
  sy: number;
}

/** 边界扰动场：对每个像素的查询坐标做一次性偏移，让 Voronoi 边界呈自然蜿蜒状。 */
export interface WarpField {
  wx: Float32Array;
  wy: Float32Array;
}

function hash2(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 1274126177) | 0;
  h = (Math.imul(h ^ (h >>> 13), 1274126177)) | 0;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 1000003) / 1000003;
}

function valueNoise2D(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const h00 = hash2(xi, yi, s), h10 = hash2(xi + 1, yi, s);
  const h01 = hash2(xi, yi + 1, s), h11 = hash2(xi + 1, yi + 1, s);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const top = h00 + (h10 - h00) * u;
  const bottom = h01 + (h11 - h01) * u;
  return top + (bottom - top) * v; // [0,1)
}

/**
 * 构建边界扰动场（低频平滑噪声，波长约 14 像素）。strength<=0 时返回全零场（等价于不启用）。
 */
export function buildWarpField(rows: number, cols: number, seed: number, strength: number): WarpField {
  const wx = new Float32Array(rows * cols);
  const wy = new Float32Array(rows * cols);
  if (strength <= 0) return { wx, wy };
  const scale = 1 / 14;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      wx[idx] = (valueNoise2D(c * scale, r * scale, seed * 2 + 11) - 0.5) * 2 * strength;
      wy[idx] = (valueNoise2D(c * scale, r * scale, seed * 2 + 37) - 0.5) * 2 * strength;
    }
  }
  return { wx, wy };
}

/** 九宫格方位转归一化中心坐标 (cx, cy)，cx/cy ∈ [0,1] */
const POSITION_MAP: [number, number][] = [
  [0, 0],         // 占位
  [0.2, 0.2],     // 1 左上
  [0.5, 0.2],     // 2 上中
  [0.8, 0.2],     // 3 右上
  [0.2, 0.5],     // 4 左中
  [0.5, 0.5],     // 5 中央
  [0.8, 0.5],     // 6 右中
  [0.2, 0.8],     // 7 左下
  [0.5, 0.8],     // 8 下中
  [0.8, 0.8],     // 9 右下
];

/**
 * 收集掩码中所有可用像素（非0）的坐标
 */
export function collectUsableCells(
  grid: number[][],
  rows: number,
  cols: number
): [number, number][] {
  const cells: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) cells.push([r, c]);
    }
  }
  return cells;
}

/**
 * 在九宫格方位的目标矩形内找到离中心最近的可用像素作为初始种子
 * 若目标矩形内无可用像素，退回到全局最近可用像素
 */
export function placeSeedPoints(
  regions: RegionDef[],
  rows: number,
  cols: number,
  usableCells: [number, number][],
  rng: () => number
): SeedPoint[] {
  if (usableCells.length === 0) return [];

  const seeds: SeedPoint[] = [];

  for (let i = 0; i < regions.length; i++) {
    const reg = regions[i];
    const pos = Math.max(1, Math.min(9, reg.position));
    const [ncx, ncy] = POSITION_MAP[pos];

    const targetR = Math.round(ncy * (rows - 1));
    const targetC = Math.round(ncx * (cols - 1));

    const winR = Math.floor(rows / 3);
    const winC = Math.floor(cols / 3);
    const r0 = Math.max(0, targetR - winR);
    const r1 = Math.min(rows - 1, targetR + winR);
    const c0 = Math.max(0, targetC - winC);
    const c1 = Math.min(cols - 1, targetC + winC);

    let bestR = -1, bestC = -1, bestDist = Infinity;
    for (const [r, c] of usableCells) {
      if (r >= r0 && r <= r1 && c >= c0 && c <= c1) {
        const d = (r - targetR) ** 2 + (c - targetC) ** 2;
        if (d < bestDist) { bestDist = d; bestR = r; bestC = c; }
      }
    }

    if (bestR < 0) {
      for (const [r, c] of usableCells) {
        const d = (r - targetR) ** 2 + (c - targetC) ** 2;
        if (d < bestDist) { bestDist = d; bestR = r; bestC = c; }
      }
    }

    let finalR = bestR + Math.round((rng() - 0.5) * 2);
    let finalC = bestC + Math.round((rng() - 0.5) * 2);
    finalR = Math.max(0, Math.min(rows - 1, finalR));
    finalC = Math.max(0, Math.min(cols - 1, finalC));

    seeds.push({ x: finalC, y: finalR, regionIdx: i });
  }

  return seeds;
}

/**
 * 标准 Voronoi 分配（每像素分给最近种子）
 * 结果天然连通，无碎片。
 */
function standardVoronoiAssign(
  seeds: SeedPoint[],
  usableCells: [number, number][],
  rows: number,
  cols: number,
  shapes?: SeedShape[],
  warp?: WarpField
): Int32Array {
  const label = new Int32Array(rows * cols).fill(-1);
  const n = seeds.length;
  for (const [r, c] of usableCells) {
    const idx = r * cols + c;
    const wr = warp ? r + warp.wy[idx] : r;
    const wc = warp ? c + warp.wx[idx] : c;
    let bestIdx = 0, bestDist = Infinity;
    for (let k = 0; k < n; k++) {
      const sx = shapes?.[k]?.sx || 1;
      const sy = shapes?.[k]?.sy || 1;
      const dr = (wr - seeds[k].y) / sy;
      const dc = (wc - seeds[k].x) / sx;
      const d = dr * dr + dc * dc;
      if (d < bestDist) { bestDist = d; bestIdx = k; }
    }
    label[idx] = bestIdx;
  }
  return label;
}

/**
 * 配额感知 Voronoi 分配
 *
 * 先做标准 Voronoi（天然连通，无碎片），再通过边界像素交换满足配额。
 * 超出配额的区域把边界像素让给不足的邻居，直到所有区域满足面积要求。
 *
 * areaRatios：占比数组，加和 ≤ 1
 */
export function quotaVoronoiAssign(
  seeds: SeedPoint[],
  areaRatios: number[],
  usableCells: [number, number][],
  rows: number,
  cols: number,
  shapes?: SeedShape[],
  warp?: WarpField
): Int32Array {
  if (seeds.length === 0 || usableCells.length === 0) {
    return new Int32Array(rows * cols).fill(-1);
  }

  const n = seeds.length;
  const totalCells = usableCells.length;
  const quota = areaRatios.map(r => Math.floor(r * totalCells));

  // ① 标准 Voronoi，保证区域连通
  const label = standardVoronoiAssign(seeds, usableCells, rows, cols, shapes, warp);
  const filled = new Int32Array(n);
  for (const [r, c] of usableCells) {
    const k = label[r * cols + c];
    if (k >= 0) filled[k]++;
  }

  // ② 找边界像素（与邻居区域不同的可用像素）
  const D4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  // usableSet 用于快速查询
  const usableSet = new Uint8Array(rows * cols);
  for (const [r, c] of usableCells) usableSet[r * cols + c] = 1;

  // 迭代：超出配额的区域把边界像素让给不足的邻居
  // 最多迭代 20 轮，防止死循环
  for (let iter = 0; iter < 20; iter++) {
    // 找所有超出配额的区域
    const over = new Set<number>();
    const under = new Set<number>();
    for (let k = 0; k < n; k++) {
      if (filled[k] > quota[k]) over.add(k);
      if (filled[k] < quota[k]) under.add(k);
    }
    if (over.size === 0 || under.size === 0) break;

    let changed = false;

    // 收集超出区域的边界像素（按到自身种子距离降序，先让远的）
    type BPixel = { r: number; c: number; k: number; dist: number; neighborK: number };
    const borderPixels: BPixel[] = [];

    for (const [r, c] of usableCells) {
      const k = label[r * cols + c];
      if (!over.has(k)) continue;
      // 找邻居中属于 under 区域的
      for (const [dr, dc] of D4) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (!usableSet[nr * cols + nc]) continue;
        const nk = label[nr * cols + nc];
        if (under.has(nk)) {
          const sx = shapes?.[k]?.sx || 1, sy = shapes?.[k]?.sy || 1;
          const dr2 = (r - seeds[k].y) / sy, dc2 = (c - seeds[k].x) / sx;
          borderPixels.push({ r, c, k, dist: dr2 * dr2 + dc2 * dc2, neighborK: nk });
          break;
        }
      }
    }

    // 按到自身种子距离降序（最远的先转让）
    borderPixels.sort((a, b) => b.dist - a.dist);

    for (const { r, c, k, neighborK } of borderPixels) {
      if (filled[k] <= quota[k]) continue; // 已经不超了
      if (filled[neighborK] >= quota[neighborK]) continue; // 邻居已满

      // 转让
      label[r * cols + c] = neighborK;
      filled[k]--;
      filled[neighborK]++;
      changed = true;
    }

    if (!changed) break;
  }

  // ③ 配额总量可能小于总可用像素（areaRatios 加和 < 1），
  //    多余像素保持标准 Voronoi 的分配（不强制置 -1），视觉更完整。
  //    真正要截断的话取消下面注释：
  // for (const [r, c] of usableCells) {
  //   const k = label[r * cols + c];
  //   if (k >= 0 && filled[k] > quota[k]) { label[r * cols + c] = -1; filled[k]--; }
  // }

  return label;
}

/**
 * 完整的 Lloyd 松弛过程
 *
 * 松弛阶段用配额感知分配计算质心，让种子自然收敛到方位区域内。
 * 因为配额分配本身已按距离排序优先分配，方位近的像素优先给对应区域，
 * 质心会稳定在方位目标附近，不需要额外锚点约束。
 */
export function lloydRelax(
  seeds: SeedPoint[],
  areaRatios: number[],
  usableCells: [number, number][],
  rows: number,
  cols: number,
  iterations: number,
  shapes?: SeedShape[],
  warp?: WarpField
): { seeds: SeedPoint[]; label: Int32Array } {
  let currentSeeds = seeds.map(s => ({ ...s }));
  const n = seeds.length;
  let label = new Int32Array(rows * cols).fill(-1);

  for (let iter = 0; iter < iterations; iter++) {
    // 用配额感知分配（方位有效）
    label = quotaVoronoiAssign(currentSeeds, areaRatios, usableCells, rows, cols, shapes, warp);

    // 计算各区域已分配像素的质心
    const sumR = new Float64Array(n);
    const sumC = new Float64Array(n);
    const count = new Int32Array(n);
    for (const [r, c] of usableCells) {
      const k = label[r * cols + c];
      if (k >= 0) { sumR[k] += r; sumC[k] += c; count[k]++; }
    }

    // 将种子移动到质心
    for (let k = 0; k < n; k++) {
      if (count[k] > 0) {
        currentSeeds[k] = {
          x: Math.round(sumC[k] / count[k]),
          y: Math.round(sumR[k] / count[k]),
          regionIdx: currentSeeds[k].regionIdx,
        };
      }
    }
  }

  // 最终分配
  label = quotaVoronoiAssign(currentSeeds, areaRatios, usableCells, rows, cols, shapes, warp);
  return { seeds: currentSeeds, label };
}
