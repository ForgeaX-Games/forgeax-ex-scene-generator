/**
 * grid_rotate: Rotate a 2D grid by 90°, 180°, or 270° clockwise.
 * Input:  grid (grid) — source grid; angle (string) — "90"|"180"|"270"
 * Output: grid (grid) — rotated grid
 */

function rotate90(src: number[][]): number[][] {
  const rows = src.length;
  if (rows === 0) return [];
  const cols = src[0].length;
  const out: number[][] = Array.from({ length: cols }, () => new Array(rows));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out[c][rows - 1 - r] = src[r][c];
    }
  }
  return out;
}

function rotate180(src: number[][]): number[][] {
  const rows = src.length;
  if (rows === 0) return [];
  const cols = src[0].length;
  const out: number[][] = Array.from({ length: rows }, () => new Array(cols));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out[rows - 1 - r][cols - 1 - c] = src[r][c];
    }
  }
  return out;
}

function rotate270(src: number[][]): number[][] {
  const rows = src.length;
  if (rows === 0) return [];
  const cols = src[0].length;
  const out: number[][] = Array.from({ length: cols }, () => new Array(rows));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out[cols - 1 - c][r] = src[r][c];
    }
  }
  return out;
}

function normalizeRect(g: number[][]): number[][] {
  if (g.length === 0 || !Array.isArray(g[0])) return [];
  const cols = g[0].length;
  let rect = true;
  for (const row of g) if (!Array.isArray(row) || row.length !== cols) { rect = false; break; }
  if (rect) return g;
  return g.map((row) => {
    if (!Array.isArray(row)) return new Array(cols).fill(0);
    if (row.length === cols) return row;
    if (row.length > cols) return row.slice(0, cols);
    const out = new Array<number>(cols);
    for (let i = 0; i < row.length; i++) out[i] = row[i];
    for (let i = row.length; i < cols; i++) out[i] = 0;
    return out;
  });
}

export function gridRotate(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const rawGrid = input.grid as number[][] | undefined;
  if (!Array.isArray(rawGrid) || rawGrid.length === 0) {
    return { error: "grid is required", grid: [] };
  }
  const grid = normalizeRect(rawGrid);

  const angle = typeof input.angle === "string" ? input.angle : "90";

  switch (angle) {
    case "180":
      return { grid: rotate180(grid) };
    case "270":
      return { grid: rotate270(grid) };
    default:
      return { grid: rotate90(grid) };
  }
}
