/**
 * regionStripeSplit: 在区域外接矩形内沿单一方向把有效格切成若干等宽条带，条带之间留 gapWidth
 * 间隙（不属于任何子区域），可选在四周留一圈 border 边带也作为间隙。每条带输出一张独立的 0/1
 * 网格，顺序沿切分方向排列；间隙列表另出一张合并网格（所有间隙/边带格=1）。
 *
 * 输入：region (grid) — 0/1（或多值）约束区，条带只落在非零有效格内
 *       direction (number/string) — 切分方向：0 或 "horizontal" 沿行切（条带横向铺展，按行分带）；
 *                                    1 或 "vertical" 沿列切（条带纵向铺展，按列分带）；
 *                                    -1 = 由 seed 随机决定（复刻老 strip 的随机朝向）
 *       bandWidth (number) — 单条带在切分方向上的厚度（行高或列宽），最小 1
 *       gapWidth (number) — 相邻条带之间的间隙厚度，最小 0
 *       border (number) — 四周保留的边带圈数（也计入 gap），最小 0
 *       seed (number) — 随机种子（仅 direction=-1 决定朝向、以及余量分配时用），0 用当前时间
 * 输出：partition (grid[], rank=1) — 每条带一张 0/1 网格，沿切分方向顺序排列，autoIterate
 *       gap (grid) — 所有间隙 + 边带格合并成的一张 0/1 网格（与输入同形状）
 *       count (number) — 实际切出的条带数
 *
 * 来源：通用化老 farmland_grid 的 generateStrip —— 去掉「田垄/作物」语义，只做纯方向性条带划分。
 * 余量（bbox 沿切分方向不能被 period 整除的部分）整体并入随机一条带，复刻老电池行为。
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

/** 所有非零格的外接矩形。 */
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

/** 解析方向参数为 horizontal 布尔（true=按行分带；横向条带）。-1 时由 rng 随机。 */
function resolveHorizontal(direction: unknown, rng: () => number): boolean {
  if (typeof direction === "string") {
    if (direction === "horizontal") return true;
    if (direction === "vertical") return false;
  }
  if (typeof direction === "number") {
    if (Math.round(direction) === 0) return true;
    if (Math.round(direction) === 1) return false;
    // -1 或其它 → 随机
  }
  return rng() < 0.5;
}

export function regionStripeSplit(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: "region is required" };
  }

  const rows = region.length;
  const cols = region[0].length;

  const bandWidth = typeof input.bandWidth === "number" ? Math.max(1, Math.round(input.bandWidth)) : 4;
  const gapWidth = typeof input.gapWidth === "number" ? Math.max(0, Math.round(input.gapWidth)) : 1;
  const border = typeof input.border === "number" ? Math.max(0, Math.round(input.border)) : 0;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;

  const rng = makeMulberry32(seed);
  const horizontal = resolveHorizontal(input.direction, rng);

  const gapGrid: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  const empty = { partition: [] as Grid[], gap: gapGrid, count: 0 };

  const bbox = getBBox(region);
  if (!bbox) return empty;
  const { r0, r1, c0, c1 } = bbox;

  // 去掉四周 border 圈后的内区
  const ir0 = r0 + border;
  const ir1 = r1 - border;
  const ic0 = c0 + border;
  const ic1 = c1 - border;
  if (ir0 > ir1 || ic0 > ic1) {
    // 全被边带吃掉：整块有效区都算 gap
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        if (region[r][c] !== 0) gapGrid[r][c] = 1;
    return empty;
  }

  const innerSpan = horizontal ? ir1 - ir0 + 1 : ic1 - ic0 + 1;
  const period = bandWidth + gapWidth;

  // N 条 band：N*bandWidth + (N-1)*gapWidth <= innerSpan
  const numBands = Math.max(1, Math.floor((innerSpan + gapWidth) / period));
  const usedSpan = numBands * bandWidth + (numBands - 1) * gapWidth;
  const rem = innerSpan - usedSpan; // >= 0，余量整体并入随机一条带
  const bonusBand = Math.floor(rng() * numBands);

  // 计算每条带在 inner offset 上的 [start,end]
  const ranges: { start: number; end: number }[] = [];
  let cursor = 0;
  for (let i = 0; i < numBands; i++) {
    const extra = i === bonusBand ? rem : 0;
    ranges.push({ start: cursor, end: cursor + bandWidth + extra - 1 });
    cursor += bandWidth + extra;
    if (i < numBands - 1) cursor += gapWidth;
  }

  // inner offset → band index（-1 = 间隙）
  const innerMap = new Int32Array(innerSpan).fill(-1);
  for (let i = 0; i < ranges.length; i++) {
    const { start, end } = ranges[i];
    for (let p = start; p <= end && p < innerSpan; p++) innerMap[p] = i;
  }

  const partition: Grid[] = Array.from({ length: numBands }, () =>
    Array.from({ length: rows }, () => new Array<number>(cols).fill(0)),
  );

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (region[r][c] === 0) continue;
      // 边带圈
      if (r < ir0 || r > ir1 || c < ic0 || c > ic1) {
        gapGrid[r][c] = 1;
        continue;
      }
      const pos = horizontal ? r - ir0 : c - ic0;
      const band = innerMap[pos];
      if (band < 0) gapGrid[r][c] = 1;
      else partition[band][r][c] = 1;
    }
  }

  // 过滤掉因掩码异形而完全为空的条带，保持 partition 与 count 一致
  const nonEmpty = partition.filter((g) => {
    for (const row of g) for (const v of row) if (v !== 0) return true;
    return false;
  });

  return { partition: nonEmpty, gap: gapGrid, count: nonEmpty.length };
}
