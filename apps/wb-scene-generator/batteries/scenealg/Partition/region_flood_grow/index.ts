/**
 * regionFloodGrow: 从一组种子点出发，在 region 约束内做随机 frontier 洪泛，长成一组有机斑块（blob）。
 *
 * 输入：region (grid) — 0/1（或多值）约束区，blob 只能长在有效格内
 *       points (grid) — 种子点掩码（非零格视为一个种子点；通常来自 alg_points_scatter）
 *       size (number) — 每个 blob 的目标格数
 *       sizeVariance (number 0..1) — 目标格数的 ±抖动比例
 *       seed (number) — 随机种子，0 用当前时间
 * 输出：partition (grid[], rank=1) — 每个 blob 一张 0/1 网格，顺序=生长顺序，autoIterate
 *       count (number) — 实际长出的 blob 数
 *
 * 算法：搬自 lake_gen 的 growLake —— 对每个种子点，从 frontier 随机取格、4-邻接扩张、达到
 * targetSize 截停，得到 organic blob。后长的 blob 避开已长 blob 的格（互不重叠）。PRNG 用项目
 * 约定的 mulberry32，给定 seed 可复现。与 region_components / region_bsp 的 partition 输出契约一致。
 *
 * 注意：与老电池 lake_gen 解耦了「串行交织共享 PRNG」——这里撒点由上游一次性完成，本电池只按
 * 点列表逐个生长，是用户接受的 organic 近似（见 README 差异说明）。
 *
 * spacingDilate (number, default 0)：湖体间距禁区。0 时行为与现状完全一致；>0 时，每个 blob 长完后
 * 对其占用格做 spacingDilate 步 4-邻接 BFS 膨胀，把膨胀覆盖的格子并入 occupied（后续 blob 的生长禁区），
 * 从而保证 blob 之间至少隔 spacingDilate 圈。膨胀格只作禁区，不计入任何 blob 的输出网格。复刻自老电池
 * lake_gen 的 minSpacing（buildForbiddenZone 逐 blob 串行建禁区），膨胀风格与 region_dilate 一致。
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

function get4Neighbors(r: number, c: number, rows: number, cols: number): [number, number][] {
  const out: [number, number][] = [];
  if (r > 0) out.push([r - 1, c]);
  if (r < rows - 1) out.push([r + 1, c]);
  if (c > 0) out.push([r, c - 1]);
  if (c < cols - 1) out.push([r, c + 1]);
  return out;
}

/**
 * 从 (startR,startC) 随机 frontier 洪泛生长一个 blob。
 * 每步从 frontier 随机取一格，将其有效且未占用的 4-邻接格立即纳入并入队，产生不规则有机形状。
 * occupied 是「已被其它 blob 占用」的格集合，保证互不重叠。
 */
function growBlob(
  validSet: Set<string>,
  occupied: Set<string>,
  startR: number,
  startC: number,
  targetSize: number,
  rows: number,
  cols: number,
  rng: () => number,
): [number, number][] {
  const startKey = `${startR},${startC}`;
  if (!validSet.has(startKey) || occupied.has(startKey)) return [];

  const blob = new Set<string>([startKey]);
  const queue: [number, number][] = [[startR, startC]];

  while (queue.length > 0 && blob.size < targetSize) {
    const idx = Math.floor(rng() * queue.length);
    const [r, c] = queue.splice(idx, 1)[0];
    for (const [nr, nc] of get4Neighbors(r, c, rows, cols)) {
      if (blob.size >= targetSize) break;
      const key = `${nr},${nc}`;
      if (!blob.has(key) && validSet.has(key) && !occupied.has(key)) {
        blob.add(key);
        queue.push([nr, nc]);
      }
    }
  }

  return [...blob].map((k) => {
    const [kr, kc] = k.split(",").map(Number);
    return [kr, kc] as [number, number];
  });
}

/**
 * 对一组占用格做 steps 步 4-邻接 BFS 膨胀，返回膨胀覆盖（含原始格）的全部格子键集合。
 * 复刻 lake_gen 的 buildForbiddenZone，膨胀风格与 region_dilate 的 4-邻接 BFS 一致。
 */
function dilateCells(
  cells: [number, number][],
  steps: number,
  rows: number,
  cols: number,
): Set<string> {
  const covered = new Set<string>(cells.map(([r, c]) => `${r},${c}`));
  let frontier: [number, number][] = [...cells];
  for (let d = 0; d < steps; d++) {
    if (frontier.length === 0) break;
    const next: [number, number][] = [];
    for (const [r, c] of frontier) {
      for (const [nr, nc] of get4Neighbors(r, c, rows, cols)) {
        const key = `${nr},${nc}`;
        if (!covered.has(key)) {
          covered.add(key);
          next.push([nr, nc]);
        }
      }
    }
    frontier = next;
  }
  return covered;
}

/** 从点掩码 grid 中按行优先收集所有非零格作为种子点。 */
function extractSeeds(points: Grid): [number, number][] {
  const seeds: [number, number][] = [];
  for (let r = 0; r < points.length; r++) {
    const row = points[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== 0) seeds.push([r, c]);
    }
  }
  return seeds;
}

export function regionFloodGrow(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  const points = input.points as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: "region is required" };
  }
  if (!points || points.length === 0 || (points[0]?.length ?? 0) === 0) {
    return { partition: [], count: 0 };
  }

  const rows = region.length;
  const cols = region[0].length;

  const size = typeof input.size === "number" ? Math.max(1, Math.round(input.size)) : 40;
  const sizeVariance = typeof input.sizeVariance === "number" ? Math.max(0, Math.min(1, input.sizeVariance)) : 0.3;
  const spacingDilate = typeof input.spacingDilate === "number" ? Math.max(0, Math.round(input.spacingDilate)) : 0;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;

  const rng = makeMulberry32(seed);

  // 有效格集合（region 非零格）
  const validSet = new Set<string>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (region[r][c] !== 0) validSet.add(`${r},${c}`);
    }
  }

  const seeds = extractSeeds(points);
  const occupied = new Set<string>();
  const partition: Grid[] = [];

  for (const [sr, sc] of seeds) {
    const jitter = (rng() * 2 - 1) * sizeVariance;
    const targetSize = Math.max(1, Math.round(size * (1 + jitter)));
    const cells = growBlob(validSet, occupied, sr, sc, targetSize, rows, cols, rng);
    if (cells.length === 0) continue;

    const blobGrid: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
    for (const [r, c] of cells) {
      blobGrid[r][c] = 1;
      occupied.add(`${r},${c}`);
    }
    partition.push(blobGrid);

    // 间距禁区：膨胀该 blob 的占用格并入 occupied，后续 blob 不能在此生长。
    // 膨胀格只作禁区，不写入任何 blob 的输出网格。
    if (spacingDilate > 0) {
      const zone = dilateCells(cells, spacingDilate, rows, cols);
      for (const key of zone) occupied.add(key);
    }
  }

  return { partition, count: partition.length };
}
