/**
 * regionSubtract: 对两张同形状 0/1 网格做差集（a 非零且 b 为零 → 1，其余 → 0）。
 *
 * 输入：a (grid), b (grid) — 同形状二维区域
 * 输出：region (grid) — 0/1 差集结果
 *
 * 算法照搬 building_generator 的 subtractGrids；单 grid 输入由 autoIterate fanout 处理。
 */

type Grid = number[][];

function subtractGrids(g1: Grid, g2: Grid): Grid {
  const rows = g1.length, cols = g1[0].length;
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (__, c) => g1[r][c] !== 0 && g2[r][c] === 0 ? 1 : 0)
  );
}

export function regionSubtract(input: Record<string, unknown>): Record<string, unknown> {
  const a = input.a as Grid | undefined;
  const b = input.b as Grid | undefined;
  if (!a || a.length === 0 || (a[0]?.length ?? 0) === 0) return { error: 'a is required' };
  if (!b || b.length === 0 || (b[0]?.length ?? 0) === 0) return { error: 'b is required' };
  if (a.length !== b.length || a[0].length !== b[0].length) {
    return { error: 'a and b must have the same shape' };
  }
  return { region: subtractGrids(a, b) };
}
