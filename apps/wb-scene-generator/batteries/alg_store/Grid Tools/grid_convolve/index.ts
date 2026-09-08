/**
 * grid_convolve: Apply a convolution kernel to a 2D grid.
 * Supports preset kernels (blur, gaussian, sharpen, edge detect, emboss)
 * and custom user-defined kernels, with configurable padding modes.
 * Input:  grid, preset, kernel, padding, normalize
 * Output: grid — convolved result
 */

// --- Preset kernels (unnormalized where noted) ---

const PRESETS: Record<string, { k: number[][]; autoNorm: boolean }> = {
  blur3x3: {
    k: [[1, 1, 1], [1, 1, 1], [1, 1, 1]],
    autoNorm: true,
  },
  blur5x5: {
    k: [
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1],
    ],
    autoNorm: true,
  },
  gaussian3x3: {
    k: [[1, 2, 1], [2, 4, 2], [1, 2, 1]],
    autoNorm: true,
  },
  gaussian5x5: {
    k: [
      [1, 4, 6, 4, 1],
      [4, 16, 24, 16, 4],
      [6, 24, 36, 24, 6],
      [4, 16, 24, 16, 4],
      [1, 4, 6, 4, 1],
    ],
    autoNorm: true,
  },
  sharpen: {
    k: [[0, -1, 0], [-1, 5, -1], [0, -1, 0]],
    autoNorm: false,
  },
  edge_laplacian: {
    k: [[0, -1, 0], [-1, 4, -1], [0, -1, 0]],
    autoNorm: false,
  },
  edge_sobel_x: {
    k: [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]],
    autoNorm: false,
  },
  edge_sobel_y: {
    k: [[-1, -2, -1], [0, 0, 0], [1, 2, 1]],
    autoNorm: false,
  },
  emboss: {
    k: [[-2, -1, 0], [-1, 1, 1], [0, 1, 2]],
    autoNorm: false,
  },
};

// --- Padding sample functions ---

type SampleFn = (grid: number[][], r: number, c: number, rows: number, cols: number) => number;

function sampleZero(grid: number[][], r: number, c: number, rows: number, cols: number): number {
  if (r < 0 || r >= rows || c < 0 || c >= cols) return 0;
  return grid[r][c];
}

function sampleClamp(grid: number[][], r: number, c: number, rows: number, cols: number): number {
  const cr = r < 0 ? 0 : r >= rows ? rows - 1 : r;
  const cc = c < 0 ? 0 : c >= cols ? cols - 1 : c;
  return grid[cr][cc];
}

function sampleWrap(grid: number[][], r: number, c: number, rows: number, cols: number): number {
  return grid[((r % rows) + rows) % rows][((c % cols) + cols) % cols];
}

function sampleReflect(grid: number[][], r: number, c: number, rows: number, cols: number): number {
  let rr = r, cc = c;
  if (rr < 0) rr = -rr - 1;
  if (rr >= rows) rr = 2 * rows - rr - 1;
  rr = Math.max(0, Math.min(rows - 1, rr));
  if (cc < 0) cc = -cc - 1;
  if (cc >= cols) cc = 2 * cols - cc - 1;
  cc = Math.max(0, Math.min(cols - 1, cc));
  return grid[rr][cc];
}

const SAMPLE_FNS: Record<string, SampleFn> = {
  zero: sampleZero,
  clamp: sampleClamp,
  wrap: sampleWrap,
  reflect: sampleReflect,
};

// --- Jagged-grid normalizer (truncate long rows / pad short rows with 0) ---
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

// --- Core convolution ---

function convolve(
  src: number[][],
  kernel: number[][],
  sample: SampleFn,
): number[][] {
  const rows = src.length;
  const cols = src[0].length;
  const kRows = kernel.length;
  const kCols = kernel[0].length;
  const halfR = Math.floor(kRows / 2);
  const halfC = Math.floor(kCols / 2);

  const out: number[][] = Array.from({ length: rows }, () => new Array(cols));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      for (let kr = 0; kr < kRows; kr++) {
        for (let kc = 0; kc < kCols; kc++) {
          const sr = r + kr - halfR;
          const sc = c + kc - halfC;
          sum += sample(src, sr, sc, rows, cols) * kernel[kr][kc];
        }
      }
      out[r][c] = sum;
    }
  }

  return out;
}

function normalizeKernel(k: number[][]): number[][] | null {
  let sum = 0;
  for (const row of k) for (const v of row) sum += v;
  if (sum === 0) return null;
  if (sum === 1) return k;
  return k.map(row => row.map(v => v / sum));
}

function parseCustomKernel(raw: unknown): number[][] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const k: number[][] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length === 0) return null;
    k.push(row.map(v => Number(v) || 0));
  }
  const cols = k[0].length;
  if (k.some(row => row.length !== cols)) return null;
  if (k.length % 2 === 0 || cols % 2 === 0) return null;
  return k;
}

export function gridConvolve(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const rawGrid = input.grid as number[][] | undefined;
  if (!Array.isArray(rawGrid) || rawGrid.length === 0 || !Array.isArray(rawGrid[0]) || rawGrid[0].length === 0) {
    return { error: "grid is required (non-empty 2D array)" };
  }
  const grid = normalizeRect(rawGrid);

  const preset = typeof input.preset === "string" ? input.preset : "blur3x3";
  const paddingMode = typeof input.padding === "string" ? input.padding : "clamp";
  const normMode = typeof input.normalize === "string" ? input.normalize : "auto";

  let kernel: number[][];
  let autoNorm: boolean;

  if (preset === "custom") {
    const parsed = parseCustomKernel(input.kernel);
    if (!parsed) {
      return { error: "custom kernel must be a 2D array with odd row and column counts" };
    }
    kernel = parsed;
    autoNorm = false;
  } else {
    const p = PRESETS[preset];
    if (!p) return { error: `unknown preset: ${preset}` };
    kernel = p.k.map(row => row.slice());
    autoNorm = p.autoNorm;
  }

  const shouldNorm =
    normMode === "yes" ||
    (normMode === "auto" && autoNorm);

  if (shouldNorm) {
    const normed = normalizeKernel(kernel);
    if (!normed) {
      return { error: "cannot normalize kernel: sum of weights is 0" };
    }
    kernel = normed;
  }

  const sample = SAMPLE_FNS[paddingMode] ?? sampleClamp;
  const result = convolve(grid, kernel, sample);

  return { grid: result };
}
