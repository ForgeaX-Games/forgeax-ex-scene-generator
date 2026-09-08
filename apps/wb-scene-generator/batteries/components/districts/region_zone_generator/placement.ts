/**
 * placement.ts
 * 种子定位、配额感知 Voronoi 分配、Lloyd 松弛
 */

export interface RegionDef {
  name: string;
  area: number;    // 面积值，以「满铺基准」为分母换算成占可用区域的比例
  position: number; // 1-9 九宫格方位
}

export interface SeedPoint {
  x: number;
  y: number;
  regionIdx: number;
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
  cols: number
): Int32Array {
  const label = new Int32Array(rows * cols).fill(-1);
  const n = seeds.length;
  for (const [r, c] of usableCells) {
    let bestIdx = 0, bestDist = Infinity;
    for (let k = 0; k < n; k++) {
      const dr = r - seeds[k].y;
      const dc = c - seeds[k].x;
      const d = dr * dr + dc * dc;
      if (d < bestDist) { bestDist = d; bestIdx = k; }
    }
    label[r * cols + c] = bestIdx;
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
  cols: number
): Int32Array {
  if (seeds.length === 0 || usableCells.length === 0) {
    return new Int32Array(rows * cols).fill(-1);
  }

  const n = seeds.length;
  const totalCells = usableCells.length;
  const quota = areaRatios.map(r => Math.floor(r * totalCells));

  // ① 标准 Voronoi，保证区域连通
  const label = standardVoronoiAssign(seeds, usableCells, rows, cols);
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
          const dr2 = r - seeds[k].y, dc2 = c - seeds[k].x;
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

  // ③ 部分填充：当占比加和 < 1（面积加和未达满铺基准）时，把每个区域中
  //    超出配额、且离种子最远的像素置空（-1），使区域收缩到方位种子周围，
  //    合计只占据 加和/基准 的比例，其余区域留空。
  //    加和 ≥ 1 时占比恰好瓜分整张可用区域，本步不触发，保持满铺。
  const ratioTotal = areaRatios.reduce((s, v) => s + v, 0);
  if (ratioTotal < 1 - 1e-6) {
    for (let k = 0; k < n; k++) {
      const excess = filled[k] - quota[k];
      if (excess <= 0) continue;
      const pix: { idx: number; dist: number }[] = [];
      for (const [r, c] of usableCells) {
        const idx = r * cols + c;
        if (label[idx] !== k) continue;
        const dr = r - seeds[k].y, dc = c - seeds[k].x;
        pix.push({ idx, dist: dr * dr + dc * dc });
      }
      // 离种子最远的先置空，保留种子周围的连通块（贴合方位特征）
      pix.sort((a, b) => b.dist - a.dist);
      for (let i = 0; i < excess && i < pix.length; i++) {
        label[pix[i].idx] = -1;
        filled[k]--;
      }
    }
  }

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
  iterations: number
): { seeds: SeedPoint[]; label: Int32Array } {
  let currentSeeds = seeds.map(s => ({ ...s }));
  const n = seeds.length;
  let label = new Int32Array(rows * cols).fill(-1);

  for (let iter = 0; iter < iterations; iter++) {
    // 用配额感知分配（方位有效）
    label = quotaVoronoiAssign(currentSeeds, areaRatios, usableCells, rows, cols);

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
  label = quotaVoronoiAssign(currentSeeds, areaRatios, usableCells, rows, cols);
  return { seeds: currentSeeds, label };
}
