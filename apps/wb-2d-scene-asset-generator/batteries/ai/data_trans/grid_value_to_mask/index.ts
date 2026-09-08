/**
 * grid_value_to_mask
 * 将网格中等于指定值的位置输出为 1，其余位置输出为 0，生成二值掩码。
 */

type Grid = number[][];

export function execute(inputs: {
  grid: Grid;
  targetValue: number;
}) {
  const { grid, targetValue } = inputs;

  if (!grid || grid.length === 0) {
    return { mask: [] as Grid };
  }

  const rows = grid.length;
  const cols = grid[0].length;
  const mask: Grid = [];

  for (let r = 0; r < rows; r++) {
    mask[r] = [];
    for (let c = 0; c < cols; c++) {
      mask[r][c] = grid[r][c] === targetValue ? 1 : 0;
    }
  }

  return { mask };
}
