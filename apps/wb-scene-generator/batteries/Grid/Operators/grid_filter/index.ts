/**
 * grid_filter: 过滤网格列表，移除非零格数量小于阈值的网格
 * 输入：gridList (grid, access:list) — 网格列表; minSize (number) — 最小非零格数阈值
 * 输出：outputGridList (grid, access:list) — 过滤后的网格列表
 *
 * 为什么是 access:list 而非 access:item：过滤一个列表本质上是集合运算——
 * 它会「删除」部分元素，使输出列表比输入短。这无法用逐项 fanout 表达（fanout 只能
 * 一进一出地变换每个分支，无法整体丢弃某些分支）。因此输入与输出都声明 access:list：
 * dispatcher 把当前父分支的全部子分支作为一组喂入，本算子返回筛选后的子集，
 * output access:list 再把结果炸回独立子分支。
 */

type Grid = number[][];

/** 统计网格中非零格的数量 */
function countNonZero(grid: Grid): number {
  let count = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (cell !== 0) count++;
    }
  }
  return count;
}

export function gridFilter(input: Record<string, unknown>): Record<string, unknown> {
  const gridList = input.gridList;
  const minSize = typeof input.minSize === "number" ? Math.floor(input.minSize) : 1;

  if (!Array.isArray(gridList)) {
    return { error: "gridList is required and must be an array", outputGridList: [] };
  }

  const outputGridList = (gridList as Grid[]).filter(g => {
    if (!Array.isArray(g) || g.length === 0) return false;
    return countNonZero(g) >= minSize;
  });

  return { outputGridList };
}
