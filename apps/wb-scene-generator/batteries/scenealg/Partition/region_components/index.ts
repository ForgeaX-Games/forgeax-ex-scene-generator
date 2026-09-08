/**
 * regionComponents: 把 region 按 4-邻接拆成独立连通分量列表。
 *
 * 输入：region (grid) — 0/1 区域
 * 输出：partition (grid[], rank=1) — 每个分量一张 0/1 网格；count (number)
 *
 * 算法照搬 building_room_split 的 splitByConnectivity（4-邻接 BFS 染色）；
 * 单 region 输入由 autoIterate fanout 处理。
 */

type Grid = number[][];

function splitByConnectivity(grid: Grid): Grid[] {
  const rows = grid.length, cols = grid[0].length;
  const visited = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const components: [number, number][][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 0 || visited[r][c]) continue;
      const comp: [number, number][] = [];
      const q: [number, number][] = [[r, c]];
      visited[r][c] = true;
      while (q.length > 0) {
        const [cr, cc] = q.shift()!;
        comp.push([cr, cc]);
        for (const [dr, dc] of dirs) {
          const nr = cr + dr, nc = cc + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc] && grid[nr][nc] !== 0) {
            visited[nr][nc] = true; q.push([nr, nc]);
          }
        }
      }
      components.push(comp);
    }
  }
  return components.map(comp => {
    const out: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
    for (const [r, c] of comp) out[r][c] = grid[r][c];
    return out;
  });
}

export function regionComponents(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { partition: [], count: 0 };
  }
  const partition = splitByConnectivity(region);
  return { partition, count: partition.length };
}
