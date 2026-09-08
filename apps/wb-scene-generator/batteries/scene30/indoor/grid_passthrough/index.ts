/**
 * grid_passthrough: 网格转接
 * 输入：grid (grid) — 源网格
 * 输出：grid (grid) — 原样传递，内容不变
 */

type Grid = number[][];

export function gridPassthrough(input: Record<string, unknown>): Record<string, unknown> {
  const grid = input.grid as Grid | undefined;

  if (!grid || !Array.isArray(grid) || grid.length === 0) {
    return { error: "grid is required and must be a non-empty 2D array" };
  }

  return { grid };
}
