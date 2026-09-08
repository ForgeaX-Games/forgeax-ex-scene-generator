/**
 * regionTopologySplit: 用 topology 切 region 成连通分量列表，可选反吸收 topology 格。
 *
 * 输入：region (grid)，topology (grid)，absorb (boolean, default false)
 * 输出：partition (grid[], rank=1)，count (number)
 *
 * 算法本体（subtractGrids / splitByConnectivity / 4-邻接反吸收）完整照搬自
 * components/interests/building_generator 的 building_room_split 步骤。
 */

type Grid = number[][];

function subtractGrids(g1: Grid, g2: Grid): Grid {
  const rows = g1.length, cols = g1[0].length;
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (__, c) => g1[r][c] !== 0 && g2[r][c] === 0 ? 1 : 0)
  );
}

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

function sameShape(a: Grid, b: Grid): boolean {
  return a.length === b.length && (a[0]?.length ?? 0) === (b[0]?.length ?? 0);
}

export function regionTopologySplit(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  const topology = input.topology as Grid | undefined;
  const absorb = input.absorb === true;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { partition: [], count: 0, error: 'region is required' };
  }
  if (!topology || !sameShape(region, topology)) {
    return { partition: [], count: 0, error: 'topology must have the same shape as region' };
  }
  const rows = region.length, cols = region[0].length;
  const interior = subtractGrids(region, topology);
  const components = splitByConnectivity(interior);

  if (absorb) {
    const dirs4: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (topology[r][c] === 0) continue;
        for (const [dr, dc] of dirs4) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          for (const comp of components) {
            if (comp[nr][nc] !== 0) { comp[r][c] = comp[nr][nc]; break; }
          }
          if (components.some(g => g[r][c] !== 0)) break;
        }
      }
    }
  }

  return { partition: components, count: components.length };
}
