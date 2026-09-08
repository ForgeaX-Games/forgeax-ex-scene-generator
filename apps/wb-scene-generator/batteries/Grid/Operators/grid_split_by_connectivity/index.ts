/**
 * gridSplitByConnectivity: 按连通性拆分单张网格（list-producer）
 * 输入：inputGrids (grid, access:item) — 待拆分网格；filterValue (number) — 边界值，默认0
 * 输出：gridsList (grid, access:list) — 该网格所有4连通区域，每个区域作为独立子分支输出
 *
 * 单网格输入，返回 grid[]；output access:list 将数组炸成独立子分支。
 * 多网格批处理交由 dispatcher 的 access:item fanout。
 */

/**
 * BFS 收集单张网格中所有4连通区域
 * 对角接触不算连通，仅上下左右4个方向
 */
function findConnectedComponents(grid: number[][], filterValue: number): number[][][] {
  const rows = grid.length;
  const cols = grid[0].length;
  const visited = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const components: [number, number][][] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === filterValue || visited[r][c]) continue;

      const component: [number, number][] = [];
      const queue: [number, number][] = [[r, c]];
      visited[r][c] = true;

      while (queue.length > 0) {
        const [cr, cc] = queue.shift()!;
        component.push([cr, cc]);

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

      components.push(component);
    }
  }

  return components.map(component => {
    const outGrid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
    for (const [r, c] of component) {
      outGrid[r][c] = grid[r][c];
    }
    return outGrid;
  });
}

/** 判断是否为单张 grid（number[][]）：第一个元素是数字数组 */
function isSingleGrid(value: unknown): value is number[][] {
  if (!Array.isArray(value) || value.length === 0) return false;
  const first = (value as unknown[])[0];
  if (!Array.isArray(first)) return false;
  if ((first as unknown[]).length === 0) return true;
  return typeof (first as unknown[])[0] === "number";
}

export function gridSplitByConnectivity(input: Record<string, unknown>): Record<string, unknown> {
  const raw = input.inputGrids;
  const filterValue = typeof input.filterValue === "number" ? input.filterValue : 0;

  if (!isSingleGrid(raw)) {
    return { error: "inputGrids is required and must be a non-empty grid (number[][])" };
  }
  const grid = raw as number[][];
  if (grid.length === 0 || grid[0].length === 0) {
    return { error: "inputGrids is required and must be non-empty" };
  }

  const gridsList = findConnectedComponents(grid, filterValue);

  return { gridsList };
}
