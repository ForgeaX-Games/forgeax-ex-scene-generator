/**
 * regionOutline: 从 region 中向内提取 thickness 层边缘格作为轮廓拓扑。
 *
 * 输入：region (grid)，thickness (number, default 1)
 * 输出：topology (grid) — 0/1 拓扑
 *
 * 算法本体（DIRS8 / findBorderPixels / outlineOne）完整照搬自
 * components/interests/building_generator 的 outline 步骤。
 */

type Grid = number[][];

const DIRS8: [number, number][] = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

function findBorderPixels(mask: boolean[][], rows: number, cols: number): boolean[][] {
  const border: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!mask[r][c]) continue;
      for (const [dr, dc] of DIRS8) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || !mask[nr][nc]) { border[r][c] = true; break; }
      }
    }
  return border;
}

function outlineOne(inputGrid: Grid, thickness: number): Grid {
  const rows = inputGrid.length, cols = inputGrid[0].length;
  const baseMask = inputGrid.map(row => row.map(v => v !== 0));
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  if (thickness <= 0) return output;
  let outline = findBorderPixels(baseMask, rows, cols);
  for (let i = 1; i < thickness; i++) {
    const next: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!outline[r][c]) continue;
      const nbrs: [number, number][] = [[r, c], [r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
      for (const [nr, nc] of nbrs) {
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || !baseMask[nr][nc]) continue;
        next[nr][nc] = true;
      }
    }
    outline = next;
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) output[r][c] = outline[r][c] ? 1 : 0;
  return output;
}

export function regionOutline(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: 'region is required' };
  }
  const thickness = typeof input.thickness === 'number' ? Math.max(1, Math.round(input.thickness)) : 1;
  return { topology: outlineOne(region, thickness) };
}
