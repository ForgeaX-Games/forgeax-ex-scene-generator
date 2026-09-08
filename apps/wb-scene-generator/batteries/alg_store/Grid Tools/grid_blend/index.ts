/**
 * Grid Blend — linearly interpolates two same-sized grids.
 * output[y][x] = gridA[y][x] * (1 - factor) + gridB[y][x] * factor
 */

export interface BlendInput {
  gridA?: number[][];
  gridB?: number[][];
  factor?: number;
}

export interface BlendOutput {
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

export function blendGrids(input: BlendInput): BlendOutput {
  const rawA = input.gridA;
  const rawB = input.gridB;

  if (!rawA || rawA.length === 0 || !rawA[0] || rawA[0].length === 0) {
    return { grid: rawB && rawB.length > 0 ? normalizeRect(rawB) : [] };
  }
  if (!rawB || rawB.length === 0 || !rawB[0] || rawB[0].length === 0) {
    return { grid: normalizeRect(rawA) };
  }
  const a = normalizeRect(rawA);
  const b = normalizeRect(rawB);

  const h = a.length;
  const w = a[0].length;

  if (b.length !== h || (b[0] && b[0].length !== w)) {
    return { grid: [] };
  }

  const rawFactor = input.factor;
  const factorNum = typeof rawFactor === "number" && Number.isFinite(rawFactor) ? rawFactor : 0.5;
  const t = Math.max(0, Math.min(1, factorNum));
  const s = 1 - t;

  const grid: number[][] = Array.from({ length: h }, (_, y) => {
    const rowA = a[y];
    const rowB = b[y];
    const out = new Array<number>(w);
    for (let x = 0; x < w; x++) {
      out[x] = rowA[x] * s + rowB[x] * t;
    }
    return out;
  });

  return { grid };
}
