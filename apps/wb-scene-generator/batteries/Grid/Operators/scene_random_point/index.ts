/**
 * sceneRandomPoint: 在网格中随机填充指定数量的点
 * 输入：grid (grid) — 输入网格; count (number) — 点位数量; fillValue (number) — 填充值; seed (number) — 随机种子
 * 输出：outputGrid (grid) — 填充后的输出网格
 */

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

function randomPoints(
  grid: number[][],
  count: number,
  fillValue: number,
  seed: number
): number[][] {
  const rows = grid.length;
  const cols = grid[0].length;

  const output: number[][] = grid.map((row) => [...row]);

  // 保留 seed===0 系统随机语义；非零 seed 用无符号 >>> 0 推导确定性种子。
  const rand = seed !== 0 ? mulberry32(seed >>> 0) : () => Math.random();

  let placed = 0;
  const maxAttempts = rows * cols * 10;
  let attempts = 0;

  while (placed < count && attempts < maxAttempts) {
    const r = Math.floor(rand() * rows);
    const c = Math.floor(rand() * cols);
    if (output[r][c] !== fillValue) {
      output[r][c] = fillValue;
      placed++;
    }
    attempts++;
  }

  return output;
}

export function sceneRandomPoint(
  input: Record<string, unknown>
): Record<string, unknown> {
  const grid = input.grid as number[][] | undefined;
  if (!grid || grid.length === 0 || grid[0].length === 0) {
    return { error: "grid is required" };
  }

  const count =
    typeof input.count === "number" ? Math.floor(input.count) : 1;
  const fillValue =
    typeof input.fillValue === "number" ? input.fillValue : 1;
  const seed =
    typeof input.seed === "number" ? Math.floor(input.seed) : 0;

  if (count <= 0) {
    return { outputGrid: grid.map((row) => [...row]) };
  }

  const outputGrid = randomPoints(grid, count, fillValue, seed);
  return { outputGrid };
}
