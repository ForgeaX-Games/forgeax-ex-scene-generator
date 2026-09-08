/**
 * gridQuarterTl: 提取网格左上角四分之一区域
 * 输入：grid (grid) — 源网格
 * 输出：quarterGrid (grid) — 左上角 ⌈w/2⌉ × ⌈h/2⌉ 子网格
 */

export function gridQuarterTl(
  input: Record<string, unknown>
): Record<string, unknown> {
  const grid = input.grid as number[][] | undefined;

  if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0])) {
    return { error: "grid is required and must be a 2D array" };
  }

  const h = grid.length;
  const w = grid[0].length;
  const qh = Math.ceil(h / 2);
  const qw = Math.ceil(w / 2);

  const quarterGrid: number[][] = [];
  for (let y = 0; y < qh; y++) {
    quarterGrid.push(grid[y].slice(0, qw));
  }

  return { quarterGrid };
}
