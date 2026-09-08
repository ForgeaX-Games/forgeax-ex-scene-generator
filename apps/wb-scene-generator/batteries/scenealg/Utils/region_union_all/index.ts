/**
 * regionUnionAll: 对一个 grid 列表整体求并集（聚合版）。
 *
 * 输入：regions (grid, access:list) — 单个 list 端口，dispatcher 在 list access 下把当前
 *   父分支下所有直接子分支的 01 grid 收集成一个 number[][][] 列表喂入。
 * 输出：region (grid, access:item) — 列表内所有 grid 逐格并集，归一为 01 的单张网格。
 *
 * 语义对标 scenealg/Utils/region_union（两 item 输入的两两并集），本电池是对一个 list
 * 整体求并的聚合版：输出尺寸取列表内所有 grid 的逐维最大值，越界格按 0 处理；任一 grid
 * 在某格非零 → 1，否则 → 0。空 list 或全无效 → { region: [] }。
 */

type Grid = number[][];

/**
 * 将 list 端口的值规范化为 Grid[]。
 * access:list 下 regions 应已是 Grid[]，但兼容「单 grid 直连被误判为二维数组」的情况：
 *   1. Grid[]  — 网格列表（标准形式）
 *   2. Grid    — 单个网格（grid 直连），自动包装为单元素列表
 */
function normalizeToGridList(value: unknown): Grid[] {
  if (!Array.isArray(value) || value.length === 0) return [];

  const first = value[0];
  if (Array.isArray(first)) {
    if (first.length === 0) return [];
    if (typeof first[0] === "number") {
      // value 本身是 Grid（二维数组）
      return [value as Grid];
    }
    if (Array.isArray(first[0])) {
      // value 是 Grid[]（三维数组）
      return (value as unknown[]).filter(
        (item) => Array.isArray(item) && (item as unknown[]).length > 0
      ) as Grid[];
    }
  }
  return [];
}

export function regionUnionAll(input: Record<string, unknown>): Record<string, unknown> {
  const grids = normalizeToGridList(input.regions).filter(
    (g) => Array.isArray(g) && g.length > 0 && Array.isArray(g[0]) && g[0].length > 0
  );
  if (grids.length === 0) return { region: [] };

  let rows = 0;
  let cols = 0;
  for (const g of grids) {
    if (g.length > rows) rows = g.length;
    if (g[0].length > cols) cols = g[0].length;
  }
  if (rows === 0 || cols === 0) return { region: [] };

  const region: Grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (__, c) => {
      const anyNonZero = grids.some((g) => {
        if (r >= g.length || c >= (g[r]?.length ?? 0)) return false;
        return g[r][c] !== 0;
      });
      return anyNonZero ? 1 : 0;
    })
  );
  return { region };
}
