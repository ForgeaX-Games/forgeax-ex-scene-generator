/**
 * grid_union_merge: 检测多个相同大小网格中的非零值并归一合并（变参聚合）
 * 输入：gridList_0, gridList_1, ... (grid, dynamicInputs access:list) — 每个端口接收一组网格
 * 输出：outputGrid (grid, access:item) — 归一合并结果，任意输入非零处为1，全部为零处为0
 *
 * dynamicInputs 以 access:list 声明：dispatcher 把每个端口当前父分支下的所有直接子
 * 分支收集为一个 number[][][] 列表喂入。本算子汇总所有端口的所有网格做并集归一化。
 */

type Grid = number[][];

/**
 * 将多个网格执行并集归一化：
 * 任一网格中某位置非零 → 输出1，所有网格该位置均为零 → 输出0。
 * 以第一个有效网格的尺寸为基准，越界位置视为0。
 */
function unionMerge(grids: Grid[]): Grid {
  const validGrids = grids.filter(g => Array.isArray(g) && g.length > 0 && g[0].length > 0);
  if (validGrids.length === 0) return [];

  const rows = validGrids[0].length;
  const cols = validGrids[0][0].length;

  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (__, c) => {
      const anyNonZero = validGrids.some(g => {
        if (r >= g.length || c >= (g[r]?.length ?? 0)) return false;
        return g[r][c] !== 0;
      });
      return anyNonZero ? 1 : 0;
    })
  );
}

/**
 * 将动态端口的值规范化为 Grid[]。
 * 支持两种输入形式：
 *   1. Grid[][]  — 网格列表（array 类型端口的标准输出）
 *   2. Grid      — 单个网格（grid 类型端口直接接入，自动包装为列表）
 */
function normalizeToGridList(value: unknown): Grid[] {
  if (!Array.isArray(value) || value.length === 0) return [];

  // 判断是单个网格（第一个元素是 number[]）还是网格列表（第一个元素是 number[][]）
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
        item => Array.isArray(item) && (item as unknown[]).length > 0
      ) as Grid[];
    }
  }
  return [];
}

export function gridUnionMerge(input: Record<string, unknown>): Record<string, unknown> {
  const grids: Grid[] = [];

  // 收集所有 gridList_<n> 动态端口（按数字序）；access:list 下每个端口已是 Grid[]，
  // normalizeToGridList 兼容「单网格直连」被误判为二维数组的情况。
  const keys = Object.keys(input)
    .filter((k) => /^gridList_\d+$/.test(k))
    .sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)));
  for (const k of keys) {
    const list = normalizeToGridList(input[k]);
    for (const g of list) {
      if (Array.isArray(g) && g.length > 0) grids.push(g);
    }
  }

  if (grids.length === 0) {
    return { error: "至少需要一个有效网格输入" };
  }

  const outputGrid = unionMerge(grids);
  return { outputGrid };
}
