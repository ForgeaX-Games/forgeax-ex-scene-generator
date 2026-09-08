/**
 * max_rectangle: Find the largest axis-aligned rectangle of non-zero cells in a grid.
 * Uses the histogram + monotone-stack approach for O(rows × cols) time.
 */

interface Rect {
  row: number;
  col: number;
  w: number;
  h: number;
}

function largestRectInHistogram(
  heights: number[],
  rowIdx: number,
): Rect {
  const n = heights.length;
  const stack: number[] = [];
  let best: Rect = { row: 0, col: 0, w: 0, h: 0 };
  let bestArea = 0;

  for (let i = 0; i <= n; i++) {
    const cur = i < n ? heights[i] : 0;
    while (stack.length > 0 && heights[stack[stack.length - 1]] > cur) {
      const h = heights[stack.pop()!];
      const w = stack.length === 0 ? i : i - stack[stack.length - 1] - 1;
      const area = h * w;
      if (area > bestArea) {
        bestArea = area;
        const left = stack.length === 0 ? 0 : stack[stack.length - 1] + 1;
        best = { row: rowIdx - h + 1, col: left, w, h };
      }
    }
    stack.push(i);
  }
  return best;
}

function findMaxRectangle(grid: number[][]): Rect {
  const rows = grid.length;
  if (rows === 0) return { row: 0, col: 0, w: 0, h: 0 };
  const cols = grid[0].length;
  if (cols === 0) return { row: 0, col: 0, w: 0, h: 0 };

  const heights = new Array<number>(cols).fill(0);
  let best: Rect = { row: 0, col: 0, w: 0, h: 0 };
  let bestArea = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      heights[c] = grid[r][c] !== 0 ? heights[c] + 1 : 0;
    }
    const candidate = largestRectInHistogram(heights, r);
    const area = candidate.w * candidate.h;
    if (area > bestArea) {
      bestArea = area;
      best = candidate;
    }
  }
  return best;
}

export function maxRectangle(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const raw = input.grid;
  if (!Array.isArray(raw) || raw.length === 0 || !Array.isArray(raw[0])) {
    return { error: "grid is required (non-empty 2D number array)" };
  }
  const grid = raw as number[][];
  const rows = grid.length;
  const cols = grid[0].length;

  const rect = findMaxRectangle(grid);
  const area = rect.w * rect.h;

  const outputGrid: number[][] = Array.from(
    { length: rows },
    () => new Array(cols).fill(0),
  );
  for (let r = rect.row; r < rect.row + rect.h && r < rows; r++) {
    for (let c = rect.col; c < rect.col + rect.w && c < cols; c++) {
      outputGrid[r][c] = 1;
    }
  }

  return {
    outputGrid,
    width: rect.w,
    height: rect.h,
    area,
  };
}
