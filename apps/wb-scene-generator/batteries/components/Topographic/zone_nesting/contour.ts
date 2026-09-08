/**
 * Boundary extraction, Moore contour tracing, and polygon fill utilities
 * for the zone_nesting battery.
 * Coordinate convention: Point = [x, y] where x = column, y = row.
 */

import type { Point } from "./algorithm";

// ---------- Constants ----------

// 8 directions in clockwise order starting from North
const CW8: [number, number][] = [
  [-1, 0], [-1, 1], [0, 1], [1, 1],
  [1, 0],  [1, -1], [0, -1], [-1, -1],
];

// ---------- Helpers ----------

function inBounds(r: number, c: number, rows: number, cols: number): boolean {
  return r >= 0 && r < rows && c >= 0 && c < cols;
}

// ---------- Compute centroid of a region ----------

/**
 * Returns the average [row, col] of all cells equal to regionId.
 * Returns null when no such cells exist.
 */
export function computeCentroid(
  grid: number[][], regionId: number
): [number, number] | null {
  let sr = 0, sc = 0, count = 0;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[0].length; c++) {
      if (grid[r][c] === regionId) {
        sr += r; sc += c; count++;
      }
    }
  }
  return count > 0 ? [Math.round(sr / count), Math.round(sc / count)] : null;
}

// ---------- Moore Neighbour Contour Tracing ----------

/**
 * Traces the outer boundary of a region using Moore neighbour tracing
 * (Ghuneim's algorithm with Jacob's stopping criterion).
 *
 * Returns an ordered closed sequence of [x, y] boundary pixel centres.
 * The sequence is clockwise when the y-axis points downward (standard grid).
 *
 * Only the TOPMOST-LEFTMOST foreground pixel is used as the start, so the
 * algorithm always produces the same result for a given grid.
 */
export function traceBoundaryContour(
  grid: number[][], regionId: number
): Point[] {
  const rows = grid.length;
  if (rows === 0) return [];
  const cols = grid[0].length;

  const isFG = (r: number, c: number): boolean =>
    inBounds(r, c, rows, cols) && grid[r][c] === regionId;

  // Find topmost-leftmost foreground pixel (it is guaranteed to be on the boundary)
  let startR = -1, startC = -1;
  outer: for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isFG(r, c)) { startR = r; startC = c; break outer; }
    }
  }
  if (startR === -1) return [];

  // Moore tracing: start entering from the background pixel to the LEFT
  // (or virtually outside the grid if startC === 0)
  const initEntryR = startR;
  const initEntryC = startC - 1; // may be -1 (treated as background)

  const contour: Point[] = [];
  let curR = startR, curC = startC;
  let entryR = initEntryR, entryC = initEntryC;
  let firstMove = true;
  const maxIter = rows * cols * 4; // safety guard

  for (let iter = 0; iter < maxIter; iter++) {
    contour.push([curC, curR]); // [x=col, y=row]

    // Direction index from curP → entryP in CW8
    const eDR = entryR - curR, eDC = entryC - curC;
    let startIdx = CW8.findIndex(([dr, dc]) => dr === eDR && dc === eDC);
    if (startIdx === -1) startIdx = 6; // fallback: West

    // Rotate CW from entry direction, find first foreground pixel
    let nextR = -1, nextC = -1;
    let lastBgR = entryR, lastBgC = entryC;

    for (let i = 1; i <= 8; i++) {
      const idx = (startIdx + i) % 8;
      const [dr, dc] = CW8[idx];
      const nr = curR + dr, nc = curC + dc;
      if (isFG(nr, nc)) {
        nextR = nr; nextC = nc;
        break;
      } else {
        lastBgR = curR + dr;
        lastBgC = curC + dc;
      }
    }

    if (nextR === -1) break; // isolated single pixel

    entryR = lastBgR;
    entryC = lastBgC;
    const prevR = curR, prevC = curC;
    curR = nextR; curC = nextC;

    // Jacob's stopping criterion: returned to start with same entry
    if (!firstMove &&
        curR === startR && curC === startC &&
        entryR === initEntryR && entryC === initEntryC) {
      break;
    }
    // Simpler early stop: returned to start pixel after at least 2 moves
    if (!firstMove && curR === startR && curC === startC) {
      // Check if we've traversed substantially (avoid degenerate single-step loop)
      if (contour.length > 2) break;
    }

    firstMove = false;
    void prevR; void prevC;
  }

  return contour;
}

// ---------- Scan-line Polygon Fill ----------

/**
 * Fills the interior of a closed polygon onto a grid using the even-odd scan-line rule.
 *
 * @param out       Target grid to write into (modified in place)
 * @param points    Closed polygon vertices [x, y] (last point implicitly connects to first)
 * @param fillValue Value written to interior cells
 */
export function scanlineFill(
  out: number[][],
  points: Point[],
  fillValue: number
): void {
  const rows = out.length;
  if (rows === 0 || points.length < 3) return;
  const cols = out[0].length;
  const n = points.length;

  for (let r = 0; r < rows; r++) {
    const y = r + 0.5; // sample at cell centre
    const intersections: number[] = [];

    for (let i = 0; i < n; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[(i + 1) % n];

      // Edge must straddle the scan line (exclusive top, inclusive bottom)
      if ((y0 < y && y <= y1) || (y1 < y && y <= y0)) {
        intersections.push(x0 + (y - y0) * (x1 - x0) / (y1 - y0));
      }
    }

    intersections.sort((a, b) => a - b);

    for (let k = 0; k + 1 < intersections.length; k += 2) {
      const c0 = Math.ceil(intersections[k] - 0.5);
      const c1 = Math.floor(intersections[k + 1] - 0.5);
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
        out[r][c] = fillValue;
      }
    }
  }
}

// ---------- Draw closed polygon border (Bresenham) ----------

function bresenham(
  grid: number[][], x0: number, y0: number, x1: number, y1: number, value: number
): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;

  while (true) {
    if (x0 >= 0 && x0 < cols && y0 >= 0 && y0 < rows) grid[y0][x0] = value;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// ---------- Post-processing utilities ----------

/**
 * Fill isolated holes inside the region.
 * A hole is a backgroundId cell surrounded by regionId on all 4 cardinal directions.
 */
function fillInteriorHoles(
  grid: number[][], regionId: number, backgroundId: number
): void {
  const rows = grid.length;
  if (rows === 0) return;
  const cols = grid[0].length;

  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        if (grid[r][c] === backgroundId) {
          const up = grid[r - 1][c];
          const down = grid[r + 1][c];
          const left = grid[r][c - 1];
          const right = grid[r][c + 1];
          if (up === regionId && down === regionId &&
              left === regionId && right === regionId) {
            grid[r][c] = regionId;
            changed = true;
          }
        }
      }
    }
  }
}

/**
 * Smooth edge irregularities by fixing X0X -> XXX and 0X0 -> 000 patterns.
 * This removes single-pixel protrusions and indentations along the boundary.
 */
function smoothEdgePattern(
  grid: number[][], regionId: number, backgroundId: number
): void {
  const rows = grid.length;
  if (rows === 0) return;
  const cols = grid[0].length;

  let changed = true;
  let iterations = 0;
  const maxIterations = 5;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    for (let r = 0; r < rows; r++) {
      for (let c = 1; c < cols - 1; c++) {
        const left = grid[r][c - 1];
        const mid = grid[r][c];
        const right = grid[r][c + 1];

        if (left === regionId && mid === backgroundId && right === regionId) {
          grid[r][c] = regionId;
          changed = true;
        } else if (left === backgroundId && mid === regionId && right === backgroundId) {
          grid[r][c] = backgroundId;
          changed = true;
        }
      }
    }

    for (let c = 0; c < cols; c++) {
      for (let r = 1; r < rows - 1; r++) {
        const up = grid[r - 1][c];
        const mid = grid[r][c];
        const down = grid[r + 1][c];

        if (up === regionId && mid === backgroundId && down === regionId) {
          grid[r][c] = regionId;
          changed = true;
        } else if (up === backgroundId && mid === regionId && down === backgroundId) {
          grid[r][c] = backgroundId;
          changed = true;
        }
      }
    }
  }
}

// ---------- Rasterise filled region ----------

/**
 * Creates a new grid from `baseGrid` where:
 *  1. All `regionId` cells are replaced by `backgroundId`.
 *  2. The splined closed polygon (boundary + interior) is drawn as `regionId`.
 *
 * Uses scan-line fill for the interior and Bresenham for the edge pixels.
 * Post-processes to fill interior holes and smooth edge patterns.
 */
export function rasterizeFilledContour(
  baseGrid: number[][],
  points: Point[],
  regionId: number,
  backgroundId: number
): number[][] {
  const rows = baseGrid.length;
  if (rows === 0 || points.length < 3) return baseGrid;
  const cols = baseGrid[0].length;

  // Clone, clearing original region
  const out = baseGrid.map(row => row.map(v => v === regionId ? backgroundId : v));

  // Clamp points to grid bounds before rasterising
  const clamped: Point[] = points.map(([x, y]) => [
    Math.max(0, Math.min(cols - 1, Math.round(x))),
    Math.max(0, Math.min(rows - 1, Math.round(y))),
  ]);

  // 1. Scan-line fill (interior)
  scanlineFill(out, clamped, regionId);

  // 2. Draw polygon border on top (ensures crisp edges)
  for (let i = 0; i < clamped.length; i++) {
    const [x0, y0] = clamped[i];
    const [x1, y1] = clamped[(i + 1) % clamped.length];
    bresenham(out, x0, y0, x1, y1, regionId);
  }

  // 3. Post-processing: fill interior holes (isolated background pixels)
  fillInteriorHoles(out, regionId, backgroundId);

  // 4. Post-processing: smooth edge patterns (X0X -> XXX, 0X0 -> 000)
  smoothEdgePattern(out, regionId, backgroundId);

  return out;
}
