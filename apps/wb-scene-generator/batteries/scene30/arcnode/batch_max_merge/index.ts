/**
 * batch_max_merge: 批量归一合并
 * 输入：gridListA (any) — 第一个网格列表（每个元素可以是单网格或网格列表）
 *       gridListB (any) — 第二个网格列表（每个元素可以是单网格或网格列表）
 * 输出：outputGridList (array) — 逐位置对应合并，长度等于两个列表中较短的那个
 *
 * 合并规则：对两个列表同一位置的所有网格（递归展平后）逐格取最大值
 */

type Grid = number[][];

function isGrid(v: unknown): v is Grid {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    Array.isArray((v as unknown[])[0]) &&
    typeof ((v as unknown[][])[0][0]) === "number"
  );
}

/** 递归展平嵌套结构，收集所有叶子网格 */
function collectGrids(value: unknown): Grid[] {
  if (isGrid(value)) return [value as Grid];
  if (Array.isArray(value)) {
    const grids: Grid[] = [];
    for (const item of value) {
      grids.push(...collectGrids(item));
    }
    return grids;
  }
  return [];
}

/** 逐格取最大值合并多个网格，以第一个有效网格尺寸为基准 */
function maxMerge(grids: Grid[]): Grid {
  const valid = grids.filter(g => g.length > 0 && g[0].length > 0);
  if (valid.length === 0) return [];

  const rows = valid[0].length;
  const cols = valid[0][0].length;

  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (__, c) =>
      valid.reduce((maxVal, g) => {
        const v = r < g.length && c < (g[r]?.length ?? 0) ? g[r][c] : 0;
        return Math.max(maxVal, v);
      }, 0)
    )
  );
}

export function batchMaxMerge(input: Record<string, unknown>): Record<string, unknown> {
  const rawA = input.gridListA;
  const rawB = input.gridListB;

  if (!Array.isArray(rawA) || rawA.length === 0) {
    return { error: "gridListA is required and must be a non-empty array" };
  }
  if (!Array.isArray(rawB) || rawB.length === 0) {
    return { error: "gridListB is required and must be a non-empty array" };
  }

  const len = Math.min(rawA.length, rawB.length);
  const outputGridList: Grid[] = [];

  for (let i = 0; i < len; i++) {
    const grids = [...collectGrids(rawA[i]), ...collectGrids(rawB[i])];
    outputGridList.push(maxMerge(grids));
  }

  return { outputGridList };
}
