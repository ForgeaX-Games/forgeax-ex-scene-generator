/**
 * grid_max_merge: 检测多个相同大小网格中的非零值，逐格取所有输入的最大值（变参聚合）
 * 输入：grid_0, grid_1, ... (grid, dynamicInputs access:item) — 每个端口一张网格
 * 输出：outputGrid (grid, access:item) — 逐格取最大值的合并结果
 *
 * dynamicInputs 以 access:item 声明：dispatcher 按 lacing 逐分支配对各端口，
 * 每次调用把 grid_0..grid_n 作为单张网格喂入，本算子在「端口维度」上跨网格取最大值。
 * 多分支批处理由 fanout 处理，execute 只合并当前这一组网格。
 */

type Grid = number[][];

/**
 * 将多个网格逐格取最大值合并。
 * 以第一个有效网格的尺寸为基准，其他网格越界位置视为0。
 */
function maxMerge(grids: Grid[]): Grid {
  const validGrids = grids.filter(g => Array.isArray(g) && g.length > 0 && g[0].length > 0);
  if (validGrids.length === 0) return [];

  const rows = validGrids[0].length;
  const cols = validGrids[0][0].length;

  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (__, c) =>
      validGrids.reduce((maxVal, g) => {
        const v = r < g.length && c < (g[r]?.length ?? 0) ? g[r][c] : 0;
        return Math.max(maxVal, v);
      }, 0)
    )
  );
}

export function gridMaxMerge(input: Record<string, unknown>): Record<string, unknown> {
  const grids: Grid[] = [];

  // 收集所有 grid_<n> 动态端口（按数字序），每个端口为单张网格
  const keys = Object.keys(input)
    .filter((k) => /^grid_\d+$/.test(k))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  for (const k of keys) {
    const g = input[k] as Grid | undefined;
    if (Array.isArray(g) && g.length > 0) grids.push(g);
  }

  if (grids.length === 0) {
    return { error: "至少需要一个有效网格输入" };
  }

  const outputGrid = maxMerge(grids);
  return { outputGrid };
}
