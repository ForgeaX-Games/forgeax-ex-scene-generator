/**
 * regionRandomFill: 概率/数量两模式的栅格填充，输出与输入同形状的 0/1 点掩码（保留格=1）。
 *
 * - mode="density"（默认，严格向后兼容）：对区域内每个有效格独立以 density 概率保留为 1，
 *   其余置 0。density=1 满铺，density=0 全空。逐格伯努利采样。
 *
 * - mode="count"（复刻老 natural_decoration 的 fillRandomCount / fillEdgeCount）：
 *     · 未接 edge 第二输入：候选有效格洗牌，取前 count 个（fillRandomCount）。
 *     · 接了 edge 第二输入：把有效格按是否属于 edge 拆成边格 / 内格，分别洗牌后拼接（边优先），
 *       取前 count 个（fillEdgeCount，用于「边缘优先精确格数」填充）。inner = 有效格中不属于 edge 的格。
 *
 * 输入：region (grid) — 0/1（或多值）约束区，只在非零有效格内填充
 *       mode (string, default "density")
 *       density (number, 0..1) — density 模式每格保留概率
 *       count (number) — count 模式目标格数
 *       edge (grid, optional) — count 模式下的边缘掩码（非零=边格），用于边优先的 fillEdgeCount 逻辑
 *       seed (number) — 随机种子，0 用当前时间
 * 输出：region (grid) — 0/1 点掩码；count (number) — 实际保留格数
 *
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

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function regionRandomFill(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: "region is required" };
  }

  const rows = region.length;
  const cols = region[0].length;

  const mode = input.mode === "count" ? "count" : "density";
  const density = typeof input.density === "number" ? Math.max(0, Math.min(1, input.density)) : 0.9;
  const count = typeof input.count === "number" ? Math.max(0, Math.floor(input.count)) : 0;
  const edge = input.edge as Grid | undefined;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;

  const rng = makeMulberry32(seed);

  const out: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  if (mode === "count") {
    // 收集有效格
    const cells: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      const row = region[r];
      for (let c = 0; c < cols; c++) {
        if ((row[c] ?? 0) !== 0) cells.push([r, c]);
      }
    }
    const n = Math.min(count, cells.length);
    if (n <= 0) return { region: out, count: 0 };

    let ordered: [number, number][];
    const hasEdge = Array.isArray(edge) && edge.length === rows && (edge[0]?.length ?? 0) === cols;
    if (hasEdge) {
      // fillEdgeCount：边格洗牌 + 内格洗牌，拼接（边优先），取前 n
      const edgeCells: [number, number][] = [];
      const innerCells: [number, number][] = [];
      for (const [r, c] of cells) {
        if ((edge![r]?.[c] ?? 0) !== 0) edgeCells.push([r, c]);
        else innerCells.push([r, c]);
      }
      ordered = [...shuffle(edgeCells, rng), ...shuffle(innerCells, rng)];
    } else {
      // fillRandomCount：候选格洗牌取前 n
      ordered = shuffle(cells, rng);
    }

    let placed = 0;
    for (let i = 0; i < n; i++) {
      const [r, c] = ordered[i];
      out[r][c] = 1;
      placed++;
    }
    return { region: out, count: placed };
  }

  // mode === "density"：逐格伯努利采样（向后兼容）
  let count2 = 0;
  for (let r = 0; r < rows; r++) {
    const row = region[r];
    for (let c = 0; c < cols; c++) {
      if ((row[c] ?? 0) === 0) continue;
      // 每格独立伯努利采样（即便 density=0/1 也消耗一次 rng，保证可复现且与 density 调整时序一致）
      if (rng() < density) {
        out[r][c] = 1;
        count2++;
      }
    }
  }

  return { region: out, count: count2 };
}
