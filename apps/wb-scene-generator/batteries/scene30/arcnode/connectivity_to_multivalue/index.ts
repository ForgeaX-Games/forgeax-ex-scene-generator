/**
 * connectivity_to_multivalue: 按连通性转多值网格
 * 输入：gridList    (any)    — 输入网格列表，每个元素为一个单值网格
 *       filterValue (number) — 边界值，该值视为隔断，不参与连通性计算，默认 0
 * 输出：outputGridList (array) — 与输入等长，每个网格中各4连通区域被赋予唯一整数值
 *
 * 赋值规则：
 *   对每个输入网格独立处理，起始填充值 = max(grid所有非filterValue的值) + 1
 *   每发现一个新的4连通区域，为该区域所有格子写入当前计数值，然后计数 +1
 *   过滤值位置保持原值（0或指定值）
 */

type Grid = number[][];

/** 求网格中所有非filterValue格子的最大值，若无则返回 baseMax */
function findMaxValue(grid: Grid, filterValue: number): number {
  let max = 0;
  for (const row of grid) {
    for (const v of row) {
      if (v !== filterValue && v > max) max = v;
    }
  }
  return max;
}

/**
 * 对单个网格按4连通性标记各区域，返回多值网格。
 * 每个连通区域赋予从 startId 开始的递增唯一整数，
 * filterValue 位置保持原值不变。
 */
function labelConnectedComponents(grid: Grid, filterValue: number, startId: number): Grid {
  const rows = grid.length;
  const cols = grid[0].length;
  const visited = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const output: Grid = grid.map(row => [...row]);
  const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  let currentId = startId;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === filterValue || visited[r][c]) continue;

      // BFS 收集当前连通区域
      const queue: [number, number][] = [[r, c]];
      const region: [number, number][] = [];
      visited[r][c] = true;

      while (queue.length > 0) {
        const [cr, cc] = queue.shift()!;
        region.push([cr, cc]);
        for (const [dr, dc] of dirs) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (
            nr >= 0 && nr < rows &&
            nc >= 0 && nc < cols &&
            !visited[nr][nc] &&
            grid[nr][nc] !== filterValue
          ) {
            visited[nr][nc] = true;
            queue.push([nr, nc]);
          }
        }
      }

      // 为该区域所有格子赋予当前 ID
      for (const [pr, pc] of region) {
        output[pr][pc] = currentId;
      }
      currentId++;
    }
  }

  return output;
}

export function connectivityToMultivalue(input: Record<string, unknown>): Record<string, unknown> {
  const rawList = input.gridList;
  const filterValue = typeof input.filterValue === "number" ? input.filterValue : 0;

  if (!Array.isArray(rawList) || rawList.length === 0) {
    return { error: "gridList is required and must be a non-empty array" };
  }

  const outputGridList: Grid[] = [];

  for (const item of rawList) {
    const grid = item as Grid;
    if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0]) || grid[0].length === 0) {
      outputGridList.push([]);
      continue;
    }

    const startId = findMaxValue(grid, filterValue) + 1;
    outputGridList.push(labelConnectedComponents(grid, filterValue, startId));
  }

  return { outputGridList };
}
