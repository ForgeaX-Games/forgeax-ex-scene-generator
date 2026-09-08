/**
 * gridSize: 计算网格中非零值的包围盒尺寸
 * 输入：grid (grid) — 输入网格
 * 输出：width (number) — 包围盒列数; height (number) — 包围盒行数
 */

function getBoundingBox(grid: number[][]): { minR: number; maxR: number; minC: number; maxC: number } | null {
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

  if (maxR === -Infinity) return null;
  return { minR, maxR, minC, maxC };
}

export function gridSize(input: Record<string, unknown>): Record<string, unknown> {
  const grid = input.grid as number[][] | undefined;

  if (!Array.isArray(grid) || grid.length === 0) {
    return { error: "grid is required" };
  }

  const bbox = getBoundingBox(grid);
  if (bbox === null) {
    return { width: 0, height: 0 };
  }

  const width = bbox.maxC - bbox.minC + 1;
  const height = bbox.maxR - bbox.minR + 1;

  return { width, height };
}
