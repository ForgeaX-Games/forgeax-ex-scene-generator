/**
 * mask_intersect: 掩码交集（两张单网格逐项配对）
 * 输入：inputGrid1 (grid, access:item)；inputGrid2 (grid, access:item)
 * 输出：outputGrid (grid, access:item) — 两网格交集，均非零处为1，否则为0
 *
 * 每次调用只处理一对网格；多对网格的批处理（含「单网格作公共掩码」）交由
 * dispatcher 的 access:item fanout + lacing 逐分支配对，execute 不再自行遍历列表。
 */

type Grid = number[][];

function isGrid(v: unknown): v is Grid {
  return Array.isArray(v) && v.length > 0 && Array.isArray((v as unknown[])[0]);
}

function intersectOne(g1: Grid, g2: Grid): Grid | string {
  const rows = g1.length;
  const cols = g1[0].length;
  if (g2.length !== rows || g2[0].length !== cols) {
    return `grid size mismatch: grid1 is ${rows}×${cols}, grid2 is ${g2.length}×${g2[0]?.length}`;
  }
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      g1[r][c] !== 0 && g2[r][c] !== 0 ? 1 : 0
    )
  );
}

export function maskIntersect(input: Record<string, unknown>): Record<string, unknown> {
  const raw1 = input.inputGrid1;
  const raw2 = input.inputGrid2;

  if (raw1 == null) return { error: "inputGrid1 is required" };
  if (raw2 == null) return { error: "inputGrid2 is required" };

  const g1 = raw1 as Grid;
  const g2 = raw2 as Grid;
  if (!isGrid(g1) || g1[0].length === 0) return { error: "inputGrid1 must be a non-empty grid" };
  if (!isGrid(g2) || g2[0].length === 0) return { error: "inputGrid2 must be a non-empty grid" };

  const result = intersectOne(g1, g2);
  if (typeof result === "string") return { error: result };
  return { outputGrid: result };
}
