/**
 * point_to_rect: 将网格中的点扩展为矩形掩码区域
 * 输入：grid (grid) — 含点的源网格；width (number) — 矩形宽度；height (number) — 矩形高度
 * 输出：outputGrid (grid) — 每个非零点扩展为指定宽高矩形，掩码值与点相同
 */

/**
 * 从输入网格中收集所有非零点，返回 [row, col, value] 三元组列表。
 */
function collectPoints(grid: number[][]): Array<[number, number, number]> {
  const points: Array<[number, number, number]> = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] !== 0) {
        points.push([r, c, grid[r][c]]);
      }
    }
  }
  return points;
}

/**
 * 在目标网格上以 (centerRow, centerCol) 为中心，绘制 rectWidth × rectHeight 的矩形掩码。
 * 矩形超出网格边界的部分自动裁剪。
 */
function stampRect(
  target: number[][],
  centerRow: number,
  centerCol: number,
  rectWidth: number,
  rectHeight: number,
  value: number
): void {
  const rows = target.length;
  const cols = target[0].length;

  const halfH = Math.floor(rectHeight / 2);
  const halfW = Math.floor(rectWidth / 2);

  const rowStart = Math.max(0, centerRow - halfH);
  const rowEnd = Math.min(rows - 1, centerRow - halfH + rectHeight - 1);
  const colStart = Math.max(0, centerCol - halfW);
  const colEnd = Math.min(cols - 1, centerCol - halfW + rectWidth - 1);

  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = colStart; c <= colEnd; c++) {
      target[r][c] = value;
    }
  }
}

export function pointToRect(input: Record<string, unknown>): Record<string, unknown> {
  const grid = input.grid as number[][] | undefined;
  if (!grid || grid.length === 0 || grid[0].length === 0) {
    return { error: "grid is required and must be non-empty" };
  }

  const rectWidth = Math.max(1, Math.floor((input.width as number) ?? 3));
  const rectHeight = Math.max(1, Math.floor((input.height as number) ?? 3));

  const rows = grid.length;
  const cols = grid[0].length;

  const outputGrid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  const points = collectPoints(grid);
  for (const [r, c, value] of points) {
    stampRect(outputGrid, r, c, rectWidth, rectHeight, value);
  }

  return { outputGrid };
}
