/**
 * cosmos_height_stretch: 将高度图每个格子的值乘以拉伸系数，输出等比例缩放后的高度图
 * 输入：inputGrid (grid) — 高度图（接 cosmos_terrain_gen.elevationGrid）
 *        stretchFactor (number) — 拉伸系数，正数；>1 放大，<1 压缩，1 原样输出
 * 输出：outputGrid (grid) — 拉伸后的整数高度网格
 */

export function cosmosHeightStretch(input: Record<string, unknown>): Record<string, unknown> {
  const heightGrid = input.inputGrid as number[][] | undefined;

  if (!heightGrid || heightGrid.length === 0) {
    return { error: "inputGrid (height grid) is required" };
  }

  const H = heightGrid.length;
  const W = heightGrid[0]?.length ?? 0;
  if (W === 0) return { error: "height grid rows are empty" };

  const stretchFactor = typeof input.stretchFactor === "number" && input.stretchFactor > 0
    ? input.stretchFactor
    : 1;

  const outputGrid: number[][] = Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (__, x) => Math.round(heightGrid[y][x] * stretchFactor))
  );

  return { outputGrid };
}
