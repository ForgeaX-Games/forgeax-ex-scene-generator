/**
 * 网格二值化 (Grid Binarize)
 * Converts a grid to binary: cells with value > threshold become 1, others become 0.
 * Self-contained — no external imports.
 */

export interface BinarizeInput {
  grid?: number[][];
  threshold?: number;
}

export interface BinarizeOutput {
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

export function binarizeGrid(input: BinarizeInput): BinarizeOutput {
  const rawSrc = input.grid;
  if (!rawSrc || rawSrc.length === 0 || !rawSrc[0] || rawSrc[0].length === 0) {
    return { grid: [] };
  }
  const src = normalizeRect(rawSrc);

  const h = src.length;
  const w = src[0].length;
  const thresholdRaw = input.threshold;
  const threshold = typeof thresholdRaw === "number" && Number.isFinite(thresholdRaw) ? thresholdRaw : 0.5;

  const grid: number[][] = Array.from({ length: h }, (_, y) => {
    const row = src[y];
    const out = new Array<number>(w);
    for (let x = 0; x < w; x++) {
      out[x] = row[x] > threshold ? 1 : 0;
    }
    return out;
  });

  return { grid };
}
