/**
 * mask_subtract: 掩码差集（网格1 减去 网格2，两张单网格逐项配对）
 * 输入：inputGrid1 (grid, access:item)；inputGrid2 (grid, access:item)
 * 输出：outputGrid (grid, access:item) — 网格1 减去 网格2 的结果
 *
 * 每次调用只处理一对网格；多对网格的批处理（含「单网格作公共掩码」）交由
 * dispatcher 的 access:item fanout + lacing 逐分支配对，execute 不再自行遍历列表。
 *
 * 尺寸不一时：按左下角对齐，输出尺寸与 grid1 相同。
 *   grid1 坐标系：行 0 = 顶部，行 rows1-1 = 底部（左下角）
 *   对齐方式：grid2 的左下角与 grid1 的左下角重合
 */

type Grid = number[][];

function isGrid(v: unknown): v is Grid {
  return Array.isArray(v) && v.length > 0 && Array.isArray((v as unknown[])[0]);
}

function subtractOne(g1: Grid, g2: Grid): Grid {
  const rows1 = g1.length;
  const cols1 = g1[0].length;
  const rows2 = g2.length;
  const cols2 = g2[0]?.length ?? 0;

  return Array.from({ length: rows1 }, (_, r) =>
    Array.from({ length: cols1 }, (_, c) => {
      if (g1[r][c] === 0) return 0;
      // 左下角对齐：grid1 行 r 对应 grid2 中从底部数相同偏移的行
      // grid1 底部行索引 = rows1-1，grid2 底部行索引 = rows2-1
      // 对应关系：r2 = r - (rows1 - rows2)
      const r2 = r - (rows1 - rows2);
      const c2 = c; // 左侧对齐，列无偏移
      if (r2 < 0 || r2 >= rows2 || c2 < 0 || c2 >= cols2) return 1;
      return g2[r2][c2] === 0 ? 1 : 0;
    })
  );
}

export function maskSubtract(input: Record<string, unknown>): Record<string, unknown> {
  const raw1 = input.inputGrid1;
  const raw2 = input.inputGrid2;

  if (raw1 == null) return { error: "inputGrid1 is required" };
  if (raw2 == null) return { error: "inputGrid2 is required" };

  const g1 = raw1 as Grid;
  const g2 = raw2 as Grid;
  if (!isGrid(g1) || g1[0].length === 0) return { error: "inputGrid1 must be a non-empty grid" };
  if (!isGrid(g2) || g2[0].length === 0) return { error: "inputGrid2 must be a non-empty grid" };

  return { outputGrid: subtractOne(g1, g2) };
}
