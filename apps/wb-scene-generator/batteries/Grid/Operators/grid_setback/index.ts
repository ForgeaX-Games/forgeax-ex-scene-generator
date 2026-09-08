/**
 * grid_setback: 对输入网格进行随机退线处理，输出退线后的网格（单网格逐项变换）
 *
 * 退线规则：
 *   - 网格随机选取 0~4 条边进行退线
 *     边数概率：0边=50%，1边=20%，2边=10%，3边=10%，4边=10%
 *   - 对选中的每条边随机退线 1~4 格
 *     退线量概率：1格=30%，2格=30%，3格=20%，4格=20%
 *   - 退线方式：以非零值的包围盒为基准，从选中边向内清零 amount 行/列的非零格
 *
 * 输入：
 *   inputGrid (grid, access:item) — 单张待退线网格
 *   intensity (number)            — 退线强度（0~1）
 *   seed (number)                 — 随机种子，0 使用当前时间戳
 *   variation (number, 可选)       — 逐网格变化量，叠加进随机种子
 * 输出：
 *   outputGrid (grid, access:item) — 退线后的网格
 *
 * 多网格批处理交由 dispatcher 的 access:item fanout，execute 只处理一张网格。
 * dispatcher 不会把逐网格序号传入 execute，因此逐网格的差异必须经由一个自身也 fanout
 * （item access）的输入端口注入：lacing 会把 variation 与 inputGrid 分支一一配对，
 * 从而让批处理中每张网格使用不同的有效种子（seed + variation）。
 */

type Grid = number[][];

// 共享 RNG：两个 battery 各自内联同一份 mulberry32（逐字节一致），不跨 battery 文件夹
// import，以契合 loader 的按文件夹动态导入模型。mulberry32 用 uint32 状态、>>> 0
// 无符号推进，返回 [0,1) 浮点数，质量好且给定 seed 确定。
/** mulberry32 伪随机数生成器，返回 [0,1) 浮点数 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 按权重数组随机抽样，返回抽中的索引。
 * weights 无需归一化，函数内部归一处理。
 */
function weightedPick(weights: number[], rng: () => number): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

/**
 * 根据 intensity（0~1）对权重数组进行偏移：
 * intensity=0 时保持原始权重；intensity=1 时大索引权重大幅提升。
 * 公式：adjustedWeight[i] = weight[i] * ((i+1) / n) ^ power
 * power 由 intensity 线性映射到 [0, 4]。
 */
function biasWeights(weights: number[], intensity: number): number[] {
  const n = weights.length;
  const power = intensity * 4; // [0, 4]
  return weights.map((w, i) => w * Math.pow((i + 1) / n, power));
}

/** 四条边的枚举：上、下、左、右 */
const SIDES = ["top", "bottom", "left", "right"] as const;
type Side = typeof SIDES[number];

/**
 * 计算网格中非零值的包围盒（行列范围）。
 * 返回 { minR, maxR, minC, maxC }，若全为零则返回 null。
 */
function nonZeroBBox(grid: Grid): { minR: number; maxR: number; minC: number; maxC: number } | null {
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== 0) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  if (minR === Infinity) return null;
  return { minR, maxR, minC, maxC };
}

/**
 * 对单个网格执行随机退线。
 * 以非零值的包围盒边界为基准，将选中边的若干行/列中的非零值清零。
 * intensity（0~1）越大，退线边数和退线量越向大值偏移。
 */
function applySetback(grid: Grid, rng: () => number, intensity: number): Grid {
  const rows = grid.length;
  const cols = rows > 0 ? grid[0].length : 0;
  if (rows === 0 || cols === 0) return grid;

  const bbox = nonZeroBBox(grid);
  if (!bbox) return grid; // 全为零，跳过

  // 深拷贝
  const result: Grid = grid.map(row => [...row]);

  // 边数概率：0边50%，1边20%，2边10%，3边10%，4边10%；intensity 向大值偏移
  const edgeCountWeights = biasWeights([50, 20, 10, 10, 10], intensity);
  const edgeCount = weightedPick(edgeCountWeights, rng);
  if (edgeCount === 0) return result;

  // 随机选取 edgeCount 条不重复的边（Fisher-Yates 洗牌）
  const shuffled = [...SIDES] as string[];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const selectedSides = shuffled.slice(0, edgeCount) as Side[];

  // 退线量概率：1格30%，2格30%，3格20%，4格20%；intensity 向大值偏移
  const setbackWeights = biasWeights([30, 30, 20, 20], intensity);

  const { minR, maxR, minC, maxC } = bbox;

  for (const side of selectedSides) {
    const amount = weightedPick(setbackWeights, rng) + 1; // 1~4

    if (side === "top") {
      // 从非零区域顶边向内清 amount 行
      const clearTo = Math.min(minR + amount, maxR + 1);
      for (let r = minR; r < clearTo; r++) {
        for (let c = minC; c <= maxC; c++) result[r][c] = 0;
      }
    } else if (side === "bottom") {
      // 从非零区域底边向内清 amount 行
      const clearFrom = Math.max(maxR - amount + 1, minR);
      for (let r = clearFrom; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) result[r][c] = 0;
      }
    } else if (side === "left") {
      // 从非零区域左边向内清 amount 列
      const clearTo = Math.min(minC + amount, maxC + 1);
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c < clearTo; c++) result[r][c] = 0;
      }
    } else {
      // 从非零区域右边向内清 amount 列
      const clearFrom = Math.max(maxC - amount + 1, minC);
      for (let r = minR; r <= maxR; r++) {
        for (let c = clearFrom; c <= maxC; c++) result[r][c] = 0;
      }
    }
  }

  return result;
}

export function gridSetback(input: Record<string, unknown>): Record<string, unknown> {
  const rawSeed = typeof input.seed === "number" ? Math.floor(input.seed) : 0;
  // 逐网格变化量：通过一个 item-access 输入注入，与 inputGrid 分支配对，使批处理中每张网格各异。
  const variation = typeof input.variation === "number" ? Math.floor(input.variation) : 0;
  // 保留 seed===0 时间戳语义，仅把 variation 叠加进种子推导；variation 为默认 0 时行为与之前一致。
  // 非零 seed 用无符号 >>> 0 推导确定性种子（不会再走 makeRng 内部隐式截断之外的路径）。
  const seed = rawSeed === 0 ? (Date.now() + variation) >>> 0 : (rawSeed + variation) >>> 0;
  const rng = mulberry32(seed);
  // intensity 钳制在 [0, 1]，默认 0.5
  const intensity = Math.max(0, Math.min(1, typeof input.intensity === "number" ? input.intensity : 0.5));

  const grid = input.inputGrid as Grid | undefined;
  if (!grid || grid.length === 0 || grid[0].length === 0) {
    return { error: "inputGrid is required and must be non-empty" };
  }

  const outputGrid = applySetback(grid, rng, intensity);

  return { outputGrid };
}
