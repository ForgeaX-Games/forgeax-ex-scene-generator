/**
 * partitionBoundaries: 从一组同形状 0/1 分块 grid 提取相邻分量之间的边界格。
 *
 * 输入：partition (grid[], rank=1)
 * 输出：topology (grid)
 *
 * 算法：
 *   1) 构建 label 网格：label[r][c] = idx+1 当且仅当第 idx 张分量在 (r,c) 非零；
 *      若多张分量在同格非零（不应发生但容错），首张胜出。0 表示该格不属于任何分量。
 *   2) 一个格 (r,c) 被标为边界，当且仅当 {自身, 8-邻接} 上出现的非零 label 数 >= 2。
 *      —— 对 BSP 缝隙：缝隙格 label=0 两侧 label 不同 → 命中；缝隙交叉点（"+"路口中心
 *         格）四个 4-邻接都是缝隙、对角才有 label，因此用 8-邻接才能补上。
 *      —— 对直接邻接（无缝隙）：两侧 label 不同，命中（产生 2 格厚边界）。
 */

type Grid = number[][];

function sameShape(a: Grid, b: Grid): boolean {
  return a.length === b.length && (a[0]?.length ?? 0) === (b[0]?.length ?? 0);
}

export function partitionBoundaries(input: Record<string, unknown>): Record<string, unknown> {
  const partition = input.partition as Grid[] | undefined;
  if (!partition || partition.length === 0) {
    return { error: 'partition is required and must be non-empty' };
  }
  const first = partition[0];
  if (!first || first.length === 0 || (first[0]?.length ?? 0) === 0) {
    return { error: 'partition entries must be non-empty grids' };
  }
  for (const g of partition) {
    if (!sameShape(first, g)) {
      return { error: 'all partition grids must have the same shape' };
    }
  }
  const rows = first.length, cols = first[0].length;

  const label: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < partition.length; i++) {
    const g = partition[i];
    const tag = i + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (g[r][c] !== 0) label[r][c] = tag;
      }
    }
  }

  const dirs9: [number, number][] = [
    [0, 0],
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1],
  ];
  const out: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let first = 0;
      let multi = false;
      for (const [dr, dc] of dirs9) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const v = label[nr][nc];
        if (v === 0) continue;
        if (first === 0) first = v;
        else if (v !== first) { multi = true; break; }
      }
      if (multi) out[r][c] = 1;
    }
  }

  return { topology: out };
}
