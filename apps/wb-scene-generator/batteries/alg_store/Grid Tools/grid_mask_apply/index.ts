/**
 * 掩码应用 (Mask Apply)
 * Applies a binary mask to a grid: keeps values where mask = 1, zeros out where mask = 0.
 * Self-contained — no external imports.
 */

export interface MaskApplyInput {
  grid?: number[][];
  mask?: number[][];
}

export interface MaskApplyOutput {
  grid: number[][];
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

export function applyMask(input: MaskApplyInput): MaskApplyOutput {
  const rawSrc = input.grid;
  const rawMask = input.mask;

  if (!rawSrc || rawSrc.length === 0 || !rawSrc[0] || rawSrc[0].length === 0) {
    return { grid: [] };
  }
  const src = normalizeRect(rawSrc);
  if (!rawMask || rawMask.length === 0 || !rawMask[0] || rawMask[0].length === 0) {
    // Deep-copy to avoid downstream mutation of upstream value.
    return { grid: src.map((row) => row.slice()) };
  }
  const mask = normalizeRect(rawMask);

  const h = src.length;
  const w = src[0].length;

  if (mask.length !== h || mask[0].length !== w) {
    return { grid: [] };
  }

  const grid: number[][] = Array.from({ length: h }, (_, y) => {
    const srcRow = src[y];
    const maskRow = mask[y];
    const out = new Array<number>(w);
    for (let x = 0; x < w; x++) {
      out[x] = maskRow[x] === 1 ? srcRow[x] : 0;
    }
    return out;
  });

  return { grid };
}
