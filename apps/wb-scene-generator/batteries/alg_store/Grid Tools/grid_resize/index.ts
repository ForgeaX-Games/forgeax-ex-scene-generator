/**
 * 网格缩放 (Grid Resize) — resizes a grid to target dimensions using
 * nearest-neighbor, bilinear, or bicubic interpolation.
 * Self-contained — no external imports.
 */

export interface InterpolateInput {
  grid?: number[][];
  width?: number;
  height?: number;
  method?: string;
}

export interface InterpolateOutput {
  grid: number[][];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function sample(src: number[][], srcH: number, srcW: number, r: number, c: number): number {
  return src[clamp(r, 0, srcH - 1)][clamp(c, 0, srcW - 1)];
}

// ── Nearest-neighbor ────────────────────────────────────────────────────
function resizeNearest(
  src: number[][], srcH: number, srcW: number,
  dstH: number, dstW: number,
): number[][] {
  const out: number[][] = Array.from({ length: dstH }, () => new Array(dstW));
  const ry = srcH / dstH;
  const rx = srcW / dstW;
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(Math.floor(y * ry), srcH - 1);
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(Math.floor(x * rx), srcW - 1);
      out[y][x] = src[sy][sx];
    }
  }
  return out;
}

// ── Bilinear ────────────────────────────────────────────────────────────
function resizeBilinear(
  src: number[][], srcH: number, srcW: number,
  dstH: number, dstW: number,
): number[][] {
  const out: number[][] = Array.from({ length: dstH }, () => new Array(dstW));
  const ry = (srcH - 1) / Math.max(1, dstH - 1);
  const rx = (srcW - 1) / Math.max(1, dstW - 1);

  for (let y = 0; y < dstH; y++) {
    const sy = y * ry;
    const y0 = Math.floor(sy);
    const y1 = Math.min(y0 + 1, srcH - 1);
    const fy = sy - y0;

    for (let x = 0; x < dstW; x++) {
      const sx = x * rx;
      const x0 = Math.floor(sx);
      const x1 = Math.min(x0 + 1, srcW - 1);
      const fx = sx - x0;

      const v00 = src[y0][x0];
      const v10 = src[y0][x1];
      const v01 = src[y1][x0];
      const v11 = src[y1][x1];

      out[y][x] =
        v00 * (1 - fx) * (1 - fy) +
        v10 * fx * (1 - fy) +
        v01 * (1 - fx) * fy +
        v11 * fx * fy;
    }
  }
  return out;
}

// ── Bicubic (Catmull-Rom) ───────────────────────────────────────────────
function cubicWeight(t: number): number {
  const at = Math.abs(t);
  if (at <= 1) return 1.5 * at * at * at - 2.5 * at * at + 1;
  if (at < 2) return -0.5 * at * at * at + 2.5 * at * at - 4 * at + 2;
  return 0;
}

function resizeBicubic(
  src: number[][], srcH: number, srcW: number,
  dstH: number, dstW: number,
): number[][] {
  const out: number[][] = Array.from({ length: dstH }, () => new Array(dstW));
  const ry = (srcH - 1) / Math.max(1, dstH - 1);
  const rx = (srcW - 1) / Math.max(1, dstW - 1);

  for (let y = 0; y < dstH; y++) {
    const sy = y * ry;
    const iy = Math.floor(sy);
    const fy = sy - iy;

    for (let x = 0; x < dstW; x++) {
      const sx = x * rx;
      const ix = Math.floor(sx);
      const fx = sx - ix;

      let sum = 0;
      for (let m = -1; m <= 2; m++) {
        const wy = cubicWeight(fy - m);
        for (let n = -1; n <= 2; n++) {
          const wx = cubicWeight(fx - n);
          sum += sample(src, srcH, srcW, iy + m, ix + n) * wy * wx;
        }
      }
      out[y][x] = sum;
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

// ── Entry point ─────────────────────────────────────────────────────────
export function interpolateGrid(input: InterpolateInput): InterpolateOutput {
  const rawSrc = input.grid;
  if (!rawSrc || rawSrc.length === 0 || !rawSrc[0] || rawSrc[0].length === 0) {
    return { grid: [] };
  }
  const src = normalizeRect(rawSrc);

  const srcH = src.length;
  const srcW = src[0].length;
  const widthRaw = input.width;
  const heightRaw = input.height;
  const widthNum = typeof widthRaw === "number" && Number.isFinite(widthRaw) ? widthRaw : 256;
  const heightNum = typeof heightRaw === "number" && Number.isFinite(heightRaw) ? heightRaw : 256;
  const dstW = Math.max(1, Math.min(2048, Math.floor(widthNum)));
  const dstH = Math.max(1, Math.min(2048, Math.floor(heightNum)));
  const method = input.method ?? "bilinear";

  if (srcH === dstH && srcW === dstW) {
    return { grid: src.map(row => [...row]) };
  }

  let grid: number[][];
  switch (method) {
    case "nearest":
      grid = resizeNearest(src, srcH, srcW, dstH, dstW);
      break;
    case "bicubic":
      grid = resizeBicubic(src, srcH, srcW, dstH, dstW);
      break;
    default:
      grid = resizeBilinear(src, srcH, srcW, dstH, dstW);
      break;
  }

  return { grid };
}
