/**
 * partitionAbsorbTopology: 把 topology 中每个非零格按 4-邻接归入第一个相邻分量。
 *
 * 输入：partition (grid[], rank=1)，topology (grid)
 * 输出：partition (grid[], rank=1)，count (number)
 *
 * 算法本体（4-邻接 dirs4 + 首相邻分量获取该 topology 格）完整照搬自
 * components/interests/building_generator 的 building_room_split 步骤里的「门洞反吸收」回路。
 * 不修改入参，深拷贝后写入。
 */

type Grid = number[][];

function sameShape(a: Grid, b: Grid): boolean {
  return a.length === b.length && (a[0]?.length ?? 0) === (b[0]?.length ?? 0);
}

export function partitionAbsorbTopology(input: Record<string, unknown>): Record<string, unknown> {
  const partition = input.partition as Grid[] | undefined;
  const topology = input.topology as Grid | undefined;
  if (!partition || partition.length === 0) {
    return { partition: [], count: 0, error: 'partition is required and must be non-empty' };
  }
  if (!topology || topology.length === 0 || (topology[0]?.length ?? 0) === 0) {
    return { partition: [], count: 0, error: 'topology is required' };
  }
  for (const g of partition) {
    if (!sameShape(topology, g)) {
      return { partition: [], count: 0, error: 'all partition grids must match topology shape' };
    }
  }

  const rows = topology.length, cols = topology[0].length;
  const out: Grid[] = partition.map(g => g.map(row => row.slice()));

  const dirs4: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (topology[r][c] === 0) continue;
      for (const [dr, dc] of dirs4) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        for (const comp of out) {
          if (comp[nr][nc] !== 0) { comp[r][c] = comp[nr][nc]; break; }
        }
        if (out.some(g => g[r][c] !== 0)) break;
      }
    }
  }

  return { partition: out, count: out.length };
}
