/**
 * grid_crop: Crop a rectangular region from a 2D grid.
 * Input:  grid, startRow, startCol, cropWidth, cropHeight
 * Output: grid — cropped sub-grid
 */

function cropGrid(
  src: number[][],
  sr: number,
  sc: number,
  w: number,
  h: number,
): number[][] {
  const rows = src.length;
  const cols = rows > 0 ? src[0].length : 0;

  const r0 = Math.max(0, Math.min(sr, rows));
  const c0 = Math.max(0, Math.min(sc, cols));
  const r1 = h <= 0 ? rows : Math.min(r0 + h, rows);
  const c1 = w <= 0 ? cols : Math.min(c0 + w, cols);

  if (r1 <= r0 || c1 <= c0) return [];

  const out: number[][] = [];
  for (let r = r0; r < r1; r++) {
    out.push(src[r].slice(c0, c1));
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

export function gridCrop(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const rawGrid = input.grid as number[][] | undefined;
  if (!Array.isArray(rawGrid) || rawGrid.length === 0) {
    return { error: "grid is required", grid: [] };
  }
  const grid = normalizeRect(rawGrid);

  const startRow = Math.floor(Number(input.startRow) || 0);
  const startCol = Math.floor(Number(input.startCol) || 0);
  const cropWidth = Math.floor(Number(input.cropWidth) || 0);
  const cropHeight = Math.floor(Number(input.cropHeight) || 0);

  const result = cropGrid(grid, startRow, startCol, cropWidth, cropHeight);
  if (result.length === 0) {
    return { error: "crop region is empty or out of bounds", grid: [] };
  }

  return { grid: result };
}
