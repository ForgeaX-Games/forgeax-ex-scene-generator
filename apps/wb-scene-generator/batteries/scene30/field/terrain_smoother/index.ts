/**
 * terrain_smoother: 细胞自动机地形平滑器
 *
 * 算法：Moore 邻域（8邻居）多数投票规则
 *   - 每轮迭代：对每个格子统计其 8 个邻居（含边界外填充）中各地形值的出现次数
 *   - 取出现次数最多的地形值作为该格的新值（平票时保留原值）
 *   - 边界格子的越界邻居视为与该格自身地形相同（边界扩展策略）
 * 效果：多轮迭代后，孤立的单格飞地被周围主体地形吸收，边界变得平滑连通
 *
 * 输入：terrainGrid (grid) — 原始地形网格；iterations (number) — 迭代次数
 * 输出：smoothedGrid (grid) — 平滑后地形网格
 */

type Grid = number[][];

/** 深拷贝二维数组 */
function cloneGrid(grid: Grid): Grid {
  return grid.map(row => [...row]);
}

/**
 * 执行一轮 Moore 邻域多数投票平滑
 * 边界外的格子使用该边界格自身的值（Clamp 扩展）
 */
function smoothOnce(grid: Grid, rows: number, cols: number): Grid {
  const result: Grid = [];

  for (let r = 0; r < rows; r++) {
    result[r] = [];
    for (let c = 0; c < cols; c++) {
      const counts = new Map<number, number>();

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          // Clamp 边界：越界坐标夹紧到有效范围
          const nr = Math.max(0, Math.min(rows - 1, r + dr));
          const nc = Math.max(0, Math.min(cols - 1, c + dc));
          const val = grid[nr][nc];
          counts.set(val, (counts.get(val) ?? 0) + 1);
        }
      }

      // 找出现次数最多的邻居地形值，平票时保留原值
      let bestVal = grid[r][c];
      let bestCount = 0;
      for (const [val, count] of counts) {
        if (count > bestCount) {
          bestCount = count;
          bestVal = val;
        }
      }

      result[r][c] = bestVal;
    }
  }

  return result;
}

export function terrainSmoother(input: Record<string, unknown>): Record<string, unknown> {
  const terrainGrid = input.terrainGrid as Grid | undefined;
  const iterations = typeof input.iterations === "number" ? Math.max(0, Math.floor(input.iterations)) : 2;

  if (!terrainGrid || !Array.isArray(terrainGrid) || terrainGrid.length === 0) {
    return { error: "terrainGrid is required and must be a non-empty 2D array" };
  }

  const rows = terrainGrid.length;
  const cols = terrainGrid[0]?.length ?? 0;
  if (cols === 0) {
    return { error: "terrainGrid rows must not be empty" };
  }

  if (iterations === 0) {
    return { smoothedGrid: cloneGrid(terrainGrid) };
  }

  let current = cloneGrid(terrainGrid);
  for (let i = 0; i < iterations; i++) {
    current = smoothOnce(current, rows, cols);
  }

  return { smoothedGrid: current };
}
