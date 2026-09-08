/**
 * rampMaskGen（坡道掩码生成）v2.0
 *
 * 读取单张二维网格，对其中每个非零区域在底边生成 2×2 坡道掩码块：
 * 上两格在区域内、下两格在区域外，坡道格保留原区域值。
 *
 * DataTree 数据格式：输入 inputGrid 与输出 outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 *
 * 输入：
 *   inputGrid    (grid)   — 单张二维网格
 *   rampPosition (number) — 坡道横向位置 0~1；-1 或缺省 → 随机
 *   seed         (number) — 随机种子（仅随机模式生效）
 * 输出：
 *   outputGrid   (grid)   — 坡道掩码网格（坡道格为原区域值，其余为 0）
 */

type Grid = number[][];

function hashSeed(seed: number): number {
  let h = (seed ^ 0xdeadbeef) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function makeLCG(seed: number): () => number {
  let s = hashSeed(seed);
  if (s === 0) s = 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** 解析单张二维网格（number[][]）；非法返回 null。
 * DataTree 模型下引擎按 access:item 对网格列表自动 fanout，本算子每次只收到一张网格。 */
function parseGrid(raw: unknown): Grid | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  if (Array.isArray(raw[0]) && typeof (raw[0] as unknown[])[0] === "number") {
    return raw as Grid;
  }
  return null;
}

/**
 * 生成单张网格的坡道掩码。
 *
 * @param grid         输入二维网格
 * @param rampPosition 0~1 表示固定位置比例；-1 表示随机
 * @param rng          随机数生成器（随机模式使用）
 * @returns            坡道掩码网格
 */
function generateRampMask(
  grid: Grid,
  rampPosition: number,
  rng: () => number,
): Grid {
  const H = grid.length;
  const W = H > 0 ? grid[0].length : 0;

  // 收集每个区域值的合法坡道候选位置
  // 合法条件：
  //   (r, c) == v，(r, c+1) == v        ← 上两格在区域内
  //   (r+1, c) == 0，(r+1, c+1) == 0   ← 下两格为空（区域外）
  const candidates = new Map<number, Array<{ r: number; c: number }>>();

  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W - 1; c++) {
      const v = grid[r][c];
      if (v === 0) continue;
      if (grid[r][c + 1] !== v) continue;
      if (r + 1 >= H) continue;
      if (grid[r + 1][c] !== 0) continue;
      if (grid[r + 1][c + 1] !== 0) continue;
      if (!candidates.has(v)) candidates.set(v, []);
      candidates.get(v)!.push({ r, c });
    }
  }

  const ramp: Grid = Array.from({ length: H }, () => new Array(W).fill(0));

  const useFixed = rampPosition >= 0 && rampPosition <= 1;

  for (const [v, list] of candidates) {
    if (list.length === 0) continue;

    let chosen: { r: number; c: number };

    if (useFixed) {
      // 按位置比例选：先按列从左到右排序，再按比例插值选最近候选
      const sortedByC = [...list].sort((a, b) => a.c - b.c);
      const targetIdx = Math.round(rampPosition * (sortedByC.length - 1));
      chosen = sortedByC[Math.max(0, Math.min(sortedByC.length - 1, targetIdx))];
    } else {
      const idx = Math.floor(rng() * list.length);
      chosen = list[idx];
    }

    const { r, c } = chosen;
    ramp[r][c]         = v;
    ramp[r][c + 1]     = v;
    ramp[r + 1][c]     = v;
    ramp[r + 1][c + 1] = v;
  }

  return ramp;
}

export function rampMaskGen(input: Record<string, unknown>): Record<string, unknown> {
  const grid = parseGrid(input.inputGrid);
  if (!grid) return { error: "inputGrid is required" };
  if (grid.length === 0 || grid[0].length === 0) return { error: "inputGrid is empty" };

  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = seedRaw === 0 ? (Date.now() & 0x7fffffff) : seedRaw;

  const rampPosRaw = typeof input.rampPosition === "number" ? input.rampPosition : -1;
  // -1 或超出 [0,1] 范围视为随机
  const rampPosition = rampPosRaw >= 0 && rampPosRaw <= 1 ? rampPosRaw : -1;

  const rng = makeLCG(baseSeed);
  const outputGrid = generateRampMask(grid, rampPosition, rng);

  return { outputGrid };
}
