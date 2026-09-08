/**
 * grid_pad: Pad a 2D grid with border rows/columns on each side.
 * Input:  grid, top, bottom, left, right, fillValue
 * Output: grid — padded grid
 */

function padGrid(
  src: number[][],
  top: number,
  bottom: number,
  left: number,
  right: number,
  fill: number,
): number[][] {
  const srcRows = src.length;
  const srcCols = srcRows > 0 ? src[0].length : 0;
  const newRows = srcRows + top + bottom;
  const newCols = srcCols + left + right;

  const out: number[][] = Array.from({ length: newRows }, () =>
    new Array(newCols).fill(fill),
  );

  for (let r = 0; r < srcRows; r++) {
    for (let c = 0; c < srcCols; c++) {
      out[r + top][c + left] = src[r][c];
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

export function gridPad(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const rawGrid = input.grid as number[][] | undefined;
  if (!Array.isArray(rawGrid) || rawGrid.length === 0) {
    return { error: "grid is required", grid: [] };
  }
  const grid = normalizeRect(rawGrid);

  // Note: `Number(undefined)` is NaN, and `NaN ?? x` does NOT fall back (?? only
  // triggers on null/undefined). So we must check the raw input before Number().
  const parsePad = (v: unknown, def: number): number => {
    if (v === undefined || v === null || v === "") return def;
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.max(0, Math.floor(n));
  };
  const top = parsePad(input.top, 1);
  const bottom = parsePad(input.bottom, 1);
  const left = parsePad(input.left, 1);
  const right = parsePad(input.right, 1);
  const fvRaw = input.fillValue;
  const fillValue =
    typeof fvRaw === "number" && Number.isFinite(fvRaw)
      ? fvRaw
      : typeof fvRaw === "string" && fvRaw !== "" && Number.isFinite(Number(fvRaw))
        ? Number(fvRaw)
        : 0;

  return { grid: padGrid(grid, top, bottom, left, right, fillValue) };
}
