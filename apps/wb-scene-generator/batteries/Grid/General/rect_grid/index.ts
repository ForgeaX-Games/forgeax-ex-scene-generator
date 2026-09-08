/**
 * rect_grid (CreateGrid): 生成指定宽高的矩形网格，所有格子填充为指定值
 * 输入：width (number) — 列数；height (number) — 行数；fillValue (number) — 填充值
 * 输出：grid (grid) — height 行 × width 列，全部填充为 fillValue
 */

export function rectGrid(input: Record<string, unknown>): Record<string, unknown> {
  const width = Math.max(1, Math.floor((input.width as number) ?? 50));
  const height = Math.max(1, Math.floor((input.height as number) ?? 50));
  const fillValue = Math.floor((input.fillValue as number) ?? 1);

  const grid: number[][] = Array.from({ length: height }, () => new Array(width).fill(fillValue));

  return { grid };
}
