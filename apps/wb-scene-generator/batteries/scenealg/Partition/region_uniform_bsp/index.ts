/**
 * regionUniformBsp: 对区域外接矩形做 BSP 递归切分 —— 每次在「全区间均匀」处下刀，
 * 两子区之间留出 pathWidth 格作为通道，每个 BSP 叶子矩形输出一张独立 0/1 网格（按生成序）。
 *
 * 输入：region (grid) — 0/1（或多值）约束区，叶子只落在非零有效格内
 *       minSize (number) — 叶子在任一方向的最小边长（格），最小 1
 *       pathWidth (number) — 两子区之间留出的通道宽度（格），最小 0
 *       maxDepth (number, default 6) — BSP 递归最大深度
 *       seed (number) — 随机种子，0 用当前时间
 * 输出：partition (grid[], rank=1) — 每个 BSP 叶子矩形一张 0/1 网格，按生成序（深度优先、先 a 后 b）
 *       gap (grid) — 叶子之间留出的 pathWidth 通道（含被叶子裁掉的边角）合并成的一张 0/1 网格
 *       count (number) — 实际切出的非空叶子数
 *
 * 来源：严格复刻老 farmland_grid 的 bsp 分支切分算法（generateBSP / bspSplit），去掉一切「田垄/作物」
 * 语义，仅把 PRNG 换成项目约定的 mulberry32 + 外部 seed。注意与 region_bsp 的偏置切分点不同：
 * 这里切分点在 [base+minSize, end-minSize-pathWidth] 全区间均匀采样。
 */

type Grid = number[][];

interface Rect { r0: number; r1: number; c0: number; c1: number }

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
 * 递归切分矩形，复刻老 farmland bsp：
 *   canH = h >= minSize*2 + pathW（可横切）；canV = w >= minSize*2 + pathW（可纵切）
 *   停止：(!canH && !canV) || depth >= maxDepth → 当前矩形作为一个叶子
 *   切向：splitH = (canH && canV) ? (rng() < 0.5) : canH
 *   切分点全区间均匀：lo = base + minSize，hi = end - minSize - pathW + 1，
 *                    split = lo + floor(rng() * (hi - lo + 1))；lo > hi 时不切，作为叶子
 *   两子区之间留 pathW 格通道（[split, split+pathW-1] 不属于任何子区）
 * 叶子按生成序（深度优先、先 a 后 b）追加。
 */
function bspSplit(
  rect: Rect, minSize: number, pathW: number, depth: number, maxDepth: number,
  rng: () => number, leaves: Rect[],
): void {
  const h = rect.r1 - rect.r0 + 1;
  const w = rect.c1 - rect.c0 + 1;
  const canH = h >= minSize * 2 + pathW;
  const canV = w >= minSize * 2 + pathW;

  if ((!canH && !canV) || depth >= maxDepth) { leaves.push(rect); return; }

  const splitH = canH && canV ? rng() < 0.5 : canH;

  if (splitH) {
    const lo = rect.r0 + minSize;
    const hi = rect.r1 - minSize - pathW + 1;
    if (lo > hi) { leaves.push(rect); return; }
    const split = lo + Math.floor(rng() * (hi - lo + 1));
    const a: Rect = { r0: rect.r0, r1: split - 1, c0: rect.c0, c1: rect.c1 };
    const b: Rect = { r0: split + pathW, r1: rect.r1, c0: rect.c0, c1: rect.c1 };
    bspSplit(a, minSize, pathW, depth + 1, maxDepth, rng, leaves);
    bspSplit(b, minSize, pathW, depth + 1, maxDepth, rng, leaves);
  } else {
    const lo = rect.c0 + minSize;
    const hi = rect.c1 - minSize - pathW + 1;
    if (lo > hi) { leaves.push(rect); return; }
    const split = lo + Math.floor(rng() * (hi - lo + 1));
    const a: Rect = { r0: rect.r0, r1: rect.r1, c0: rect.c0, c1: split - 1 };
    const b: Rect = { r0: rect.r0, r1: rect.r1, c0: split + pathW, c1: rect.c1 };
    bspSplit(a, minSize, pathW, depth + 1, maxDepth, rng, leaves);
    bspSplit(b, minSize, pathW, depth + 1, maxDepth, rng, leaves);
  }
}

export function regionUniformBsp(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: "region is required" };
  }

  const rows = region.length;
  const cols = region[0].length;

  const minSize = typeof input.minSize === "number" ? Math.max(1, Math.round(input.minSize)) : 4;
  const pathWidth = typeof input.pathWidth === "number" ? Math.max(0, Math.round(input.pathWidth)) : 1;
  const maxDepth = typeof input.maxDepth === "number" ? Math.max(0, Math.round(input.maxDepth)) : 6;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;

  const rng = makeMulberry32(seed);

  const gapGrid: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  const empty = { partition: [] as Grid[], gap: gapGrid, count: 0 };

  const bbox = getBBox(region);
  if (!bbox) return empty;

  const leaves: Rect[] = [];
  bspSplit(bbox, minSize, pathWidth, 0, maxDepth, rng, leaves);

  // 每个叶子裁到 region 非零格内，落成一张 0/1 网格，剔除被掩码截没的空叶子
  const partition: Grid[] = [];
  // 记录哪些有效格被某个叶子占用，剩下的非零格即为 gap（切口通道 + 被裁掉的边角）
  const occupied: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (const leaf of leaves) {
    const g: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
    let nonEmpty = false;
    for (let r = leaf.r0; r <= leaf.r1; r++) {
      if (r < 0 || r >= rows) continue;
      for (let c = leaf.c0; c <= leaf.c1; c++) {
        if (c < 0 || c >= cols) continue;
        if (region[r][c] !== 0) {
          g[r][c] = 1;
          occupied[r][c] = 1;
          nonEmpty = true;
        }
      }
    }
    if (nonEmpty) partition.push(g);
  }

  // gap = region 非零 且 未被任何叶子占用的格
  for (let r = bbox.r0; r <= bbox.r1; r++) {
    for (let c = bbox.c0; c <= bbox.c1; c++) {
      if (region[r][c] !== 0 && occupied[r][c] === 0) gapGrid[r][c] = 1;
    }
  }

  return { partition, gap: gapGrid, count: partition.length };
}
