/**
 * gridSplitByValue: 将多值网格按不同值拆分为多个独立网格组成的列表
 * 输入：grid (grid, access:item) — 待拆分的多值网格
 * 输出：grids (grid, access:list) — 每个不同值一张子网格，作为独立子分支输出，其余位置为0
 *
 * 单网格输入，返回 grid[]；output access:list 将数组炸成独立子分支。
 */

/**
 * 收集网格中所有不同的非零值，并按升序排列
 */
function collectDistinctValues(grid: number[][]): number[] {
  const seen = new Set<number>();
  for (const row of grid) {
    for (const cell of row) {
      if (cell !== 0) seen.add(cell);
    }
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/**
 * 从原始网格中提取指定值的子网格：
 * 匹配的位置保留原值，其余置0
 */
function extractValueGrid(grid: number[][], value: number): number[][] {
  return grid.map((row) => row.map((cell) => (cell === value ? value : 0)));
}

export function gridSplitByValue(input: Record<string, unknown>): Record<string, unknown> {
  const grid = input.grid as number[][] | undefined;

  if (!grid || grid.length === 0 || grid[0].length === 0) {
    return { error: "grid is required and must be non-empty" };
  }

  const distinctValues = collectDistinctValues(grid);
  const grids = distinctValues.map((value) => extractValueGrid(grid, value));

  // Parallel list of the split keys (same order as `grids`) — wire to
  // grid2node.z for elevation bands (HillContour etc.).
  return { grids, values: distinctValues };
}
