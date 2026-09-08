/**
 * regionGridSplit: 在区域外接矩形内做规则网格细分 —— 行、列两个方向同时按 cellHeight×cellWidth
 * 切块，块之间留 gapWidth 间隙（既做横向也做纵向小径），每个网格单元（plot）输出一张独立 0/1 网格，
 * 顺序为行优先（先上后下、先左后右）。所有间隙合并成一张 gap 网格。
 *
 * 输入：region (grid) — 0/1（或多值）约束区，单元只落在非零有效格内
 *       cellWidth (number) — 单元列宽，最小 1
 *       cellHeight (number) — 单元行高，最小 1
 *       gapWidth (number) — 单元之间的间隙宽度（行列通用），最小 0
 *       seed (number) — 随机种子（用于把行/列余量分配给随机一个 band），0 用当前时间
 * 输出：partition (grid[], rank=1) — 每个网格单元一张 0/1 网格，行优先顺序，autoIterate
 *       gap (grid) — 所有横/纵间隙合并成的一张 0/1 网格（与输入同形状）
 *       count (number) — 实际切出的非空单元数
 *
 * 来源：通用化老 farmland_grid 的 generateGrid —— 去掉「田垄/作物」语义，只做纯规则网格划分。
 * 行、列各自的余量（bbox 不能被 period 整除的部分）整体并入随机一个 band，复刻老电池行为。
 * PRNG 用项目约定的 mulberry32，给定 seed 可复现。单 region 输入由 autoIterate fanout。
 */

type Grid = number[][];

function makeMulberry32(seed: number): () => number {
  let s = (seed === 0 ? Date.now() : seed) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getBBox(grid: Grid): { r0: number; r1: number; c0: number; c1: number } | null {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  let r0 = rows, r1 = -1, c0 = cols, c1 = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) {
        if (r < r0) r0 = r;
        if (r > r1) r1 = r;
        if (c < c0) c0 = c;
        if (c > c1) c1 = c;
      }
    }
  }
  return r1 === -1 ? null : { r0, r1, c0, c1 };
}

/**
 * 沿一个方向把 span 切成若干 band，band 间距严格 gapWidth（末尾无尾间隙）。
 * 不能整除的余量整体并入随机一个 band（bonusBand）。返回 span offset → band index 映射（-1=间隙）。
 */
function buildBandMap(span: number, bandSize: number, gapWidth: number, rng: () => number): Int32Array {
  const period = bandSize + gapWidth;
  const numBands = Math.max(1, Math.floor((span + gapWidth) / period));
  const used = numBands * bandSize + (numBands - 1) * gapWidth;
  const rem = span - used; // >= 0
  const bonusBand = Math.floor(rng() * numBands);

  const map = new Int32Array(span).fill(-1);
  let cursor = 0;
  for (let i = 0; i < numBands; i++) {
    const extra = i === bonusBand ? rem : 0;
    const start = cursor;
    const end = cursor + bandSize + extra - 1;
    for (let p = start; p <= end && p < span; p++) map[p] = i;
    cursor += bandSize + extra;
    if (i < numBands - 1) cursor += gapWidth;
  }
  return map;
}

export function regionGridSplit(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: "region is required" };
  }

  const rows = region.length;
  const cols = region[0].length;

  const cellWidth = typeof input.cellWidth === "number" ? Math.max(1, Math.round(input.cellWidth)) : 4;
  const cellHeight = typeof input.cellHeight === "number" ? Math.max(1, Math.round(input.cellHeight)) : 4;
  const gapWidth = typeof input.gapWidth === "number" ? Math.max(0, Math.round(input.gapWidth)) : 1;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;

  const rng = makeMulberry32(seed);

  const gapGrid: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  const empty = { partition: [] as Grid[], gap: gapGrid, count: 0 };

  const bbox = getBBox(region);
  if (!bbox) return empty;
  const { r0, r1, c0, c1 } = bbox;

  const spanR = r1 - r0 + 1;
  const spanC = c1 - c0 + 1;

  const rowMap = buildBandMap(spanR, cellHeight, gapWidth, rng);
  const colMap = buildBandMap(spanC, cellWidth, gapWidth, rng);

  const numBandsR = Math.max(0, ...Array.from(rowMap)) + 1;
  const numBandsC = Math.max(0, ...Array.from(colMap)) + 1;

  // 每个 (bandR, bandC) 单元一张网格，行优先索引
  const cellIndex = (br: number, bc: number) => br * numBandsC + bc;
  const partition: (Grid | null)[] = new Array(numBandsR * numBandsC).fill(null);

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (region[r][c] === 0) continue;
      const br = rowMap[r - r0];
      const bc = colMap[c - c0];
      if (br < 0 || bc < 0) {
        gapGrid[r][c] = 1;
        continue;
      }
      const idx = cellIndex(br, bc);
      let g = partition[idx];
      if (!g) {
        g = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
        partition[idx] = g;
      }
      g[r][c] = 1;
    }
  }

  // 行优先收集非空单元
  // （partition 数组按 idx = br*numBandsC + bc 索引，遍历即行优先序）
  const out: Grid[] = [];
  for (let idx = 0; idx < partition.length; idx++) {
    const g = partition[idx];
    if (!g) continue;
    out.push(g);
  }

  return { partition: out, gap: gapGrid, count: out.length };
}
