/**
 * gridListToMulti: 将单值网格列表合并为一张多值网格，填充值从 1 起按列表顺序递增
 * 输入：grids (grid, access:list) — 单值网格列表，每个元素为 number[][]
 * 输出：outputGrid (grid, access:item) — 合并后的多值网格；重叠时后序网格覆盖先序网格
 *
 * 这是「跨一组网格的真聚合」：access:list 让 dispatcher 把当前父分支的所有直接子分支
 * 作为一个 number[][][] 列表整体喂入，本算子据此叠放合并为单张多值网格。
 */

function validateGrids(grids: unknown[]): { rows: number; cols: number } | null {
  if (grids.length === 0) return null;
  const first = grids[0] as number[][];
  if (!Array.isArray(first) || first.length === 0 || !Array.isArray(first[0])) return null;
  return { rows: first.length, cols: first[0].length };
}

export function gridListToMulti(input: Record<string, unknown>): Record<string, unknown> {
  const raw = input.grids;

  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "grids is required and must be a non-empty array" };
  }

  const grids = raw as number[][][];
  const dims = validateGrids(grids);
  if (!dims) {
    return { error: "grids contains an invalid or empty grid" };
  }

  const { rows, cols } = dims;
  const outputGrid: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < grids.length; i++) {
    const grid = grids[i];
    if (!Array.isArray(grid)) continue;

    const fillValue = i + 1;

    for (let r = 0; r < rows; r++) {
      const row = grid[r];
      if (!Array.isArray(row)) continue;
      for (let c = 0; c < cols; c++) {
        if (row[c] !== 0) {
          outputGrid[r][c] = fillValue;
        }
      }
    }
  }

  return { outputGrid };
}
