/**
 * gridOps: 网格基础操作
 * mask_subtract（差集）、batch_max_merge（取最大合并）
 */

import type { Grid } from "./buildingCarve.js";

/** g1 非零 且 g2 为零 → 1，否则 0。对应 mask_subtract */
export function subtractGrids(g1: Grid, g2: Grid): Grid {
  const rows = g1.length, cols = g1[0].length;
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (__, c) =>
      g1[r][c] !== 0 && g2[r][c] === 0 ? 1 : 0
    )
  );
}

/** 逐格取最大合并多个网格。对应 batch_max_merge 单次操作 */
export function maxMergeGrids(grids: Grid[]): Grid {
  const valid = grids.filter(g => g.length > 0 && g[0] && g[0].length > 0);
  if (valid.length === 0) return [];
  const rows = valid[0].length, cols = valid[0][0].length;
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (__, c) =>
      valid.reduce((mx, g) => Math.max(mx, r < g.length && c < (g[r]?.length ?? 0) ? g[r][c] : 0), 0)
    )
  );
}

/** 批量差集：对等长列表逐项做 subtract。inputGrid2 也可为单网格（作公共掩码）*/
export function subtractLists(list1: Grid[], list2: Grid[] | Grid): Grid[] {
  const isList2 = Array.isArray(list2) && list2.length > 0 && Array.isArray(list2[0]);
  return list1.map((g1, i) => {
    const g2 = isList2 ? (list2 as Grid[])[i] : (list2 as Grid);
    if (!g1 || !g2 || g1.length === 0 || g2.length === 0) return [];
    return subtractGrids(g1, g2);
  });
}

/** 批量 max merge：对等长列表 A[i] 和 B[i] 逐项取最大合并 */
export function batchMaxMerge(listA: Grid[], listB: Grid[]): Grid[] {
  const len = Math.min(listA.length, listB.length);
  return Array.from({ length: len }, (_, i) => maxMergeGrids([listA[i], listB[i]]));
}
