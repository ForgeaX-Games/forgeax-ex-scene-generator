/**
 * Chess-town grid road generator using two-level BSP.
 *
 * Level 1 – main-road BSP:
 *   Recursively splits the target bounding box; each split line becomes a
 *   main road, and the resulting sub-regions become "super-blocks".
 *
 * Level 2 – sub-road BSP (within each super-block):
 *   Each super-block is further split; each split line becomes a sub-road,
 *   and the final leaf regions become individual parcels.
 *
 * All road/parcel cells are constrained to the target mask, so irregular
 * input shapes are handled correctly.
 */

export interface ChessRoadOptions {
  mainRoadWidth: number;
  subRoadWidth: number;
  mainBlockMinSize: number;
  parcelMinSize: number;
  /** Minimum fraction (0–0.5) each side must be after a split. Default 0.4. */
  splitRatio: number;
  seed: number;
}

export interface NameEntry {
  id: number;
  name: string;
}

export interface ChessRoadResult {
  mainRoad: number[][];
  subRoad: number[][];
  parcels: number[][];
  nameList: NameEntry[];
}

// ---------- Internal types ----------

interface Block { x: number; y: number; w: number; h: number; }

// ---------- RNG ----------

function makeRng(seed: number): () => number {
  let s = (seed === 0 ? Date.now() : seed) >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223;
    return (s >>> 0) / 0x100000000;
  };
}

// ---------- Core BSP split ----------

/**
 * Recursively splits `block` using BSP.
 *
 * At each split a strip of `roadWidth` rows/columns is painted on `roadGrid`
 * (only where `mask` is true). The two child blocks exclude the road strip.
 *
 * Returns the list of leaf blocks that were not further split.
 */
function bspSplit(
  block: Block,
  minSize: number,
  roadWidth: number,
  splitRatio: number,
  roadGrid: number[][],
  mask: boolean[][],
  rows: number,
  cols: number,
  rng: () => number,
): Block[] {
  // A block can be split only if both halves remain ≥ minSize after the road strip
  const canH = block.h >= minSize * 2 + roadWidth;
  const canV = block.w >= minSize * 2 + roadWidth;

  if (!canH && !canV) return [block]; // leaf

  const splitH = canH && (!canV || rng() < 0.5);

  if (splitH) {
    // Valid split offset range (relative to block.y)
    const lo = Math.max(minSize, Math.floor(block.h * splitRatio));
    const hi = Math.min(
      block.h - minSize - roadWidth,
      Math.floor(block.h * (1 - splitRatio)) - roadWidth,
    );
    if (lo > hi) return [block];

    const split = lo + Math.floor(rng() * (hi - lo + 1));

    // Paint road rows: block.y + split  ..  block.y + split + roadWidth - 1
    for (let dy = 0; dy < roadWidth; dy++) {
      const r = block.y + split + dy;
      if (r < 0 || r >= rows) continue;
      for (let c = block.x; c < block.x + block.w; c++) {
        if (c >= 0 && c < cols && mask[r][c]) roadGrid[r][c] = 1;
      }
    }

    const top: Block    = { x: block.x, y: block.y,                    w: block.w, h: split };
    const bottom: Block = { x: block.x, y: block.y + split + roadWidth, w: block.w, h: block.h - split - roadWidth };

    return [
      ...bspSplit(top,    minSize, roadWidth, splitRatio, roadGrid, mask, rows, cols, rng),
      ...bspSplit(bottom, minSize, roadWidth, splitRatio, roadGrid, mask, rows, cols, rng),
    ];
  } else {
    const lo = Math.max(minSize, Math.floor(block.w * splitRatio));
    const hi = Math.min(
      block.w - minSize - roadWidth,
      Math.floor(block.w * (1 - splitRatio)) - roadWidth,
    );
    if (lo > hi) return [block];

    const split = lo + Math.floor(rng() * (hi - lo + 1));

    // Paint road columns: block.x + split  ..  block.x + split + roadWidth - 1
    for (let dx = 0; dx < roadWidth; dx++) {
      const c = block.x + split + dx;
      if (c < 0 || c >= cols) continue;
      for (let r = block.y; r < block.y + block.h; r++) {
        if (r >= 0 && r < rows && mask[r][c]) roadGrid[r][c] = 1;
      }
    }

    const left: Block  = { x: block.x,              y: block.y, w: split,                    h: block.h };
    const right: Block = { x: block.x + split + roadWidth, y: block.y, w: block.w - split - roadWidth, h: block.h };

    return [
      ...bspSplit(left,  minSize, roadWidth, splitRatio, roadGrid, mask, rows, cols, rng),
      ...bspSplit(right, minSize, roadWidth, splitRatio, roadGrid, mask, rows, cols, rng),
    ];
  }
}

// ---------- Main entry ----------

export function generateChessRoad(grid: number[][], opts: ChessRoadOptions): ChessRoadResult {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const empty = (): number[][] => Array.from({ length: rows }, () => new Array(cols).fill(0));

  if (rows === 0 || cols === 0) return { mainRoad: empty(), subRoad: empty(), parcels: empty() };

  // Build target mask and bounding box
  const mask: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  let minX = cols, minY = rows, maxX = -1, maxY = -1;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) {
        mask[r][c] = true;
        if (c < minX) minX = c;
        if (c > maxX) maxX = c;
        if (r < minY) minY = r;
        if (r > maxY) maxY = r;
      }
    }
  }

  if (maxX < 0) return { mainRoad: empty(), subRoad: empty(), parcels: empty(), nameList: [] };

  const rng = makeRng(opts.seed);
  const mainRoad = empty();
  const subRoad  = empty();
  const parcels  = empty();

  const root: Block = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };

  // ── Level 1: main roads ──────────────────────────────────────────────────
  const superBlocks = bspSplit(
    root,
    opts.mainBlockMinSize,
    opts.mainRoadWidth,
    Math.min(0.5, Math.max(0, opts.splitRatio)),
    mainRoad, mask, rows, cols, rng,
  );

  // ── Level 2: sub-roads within each super-block ───────────────────────────
  let parcelId = 1;
  const nameList: NameEntry[] = [];

  for (const superBlock of superBlocks) {
    const parcelBlocks = bspSplit(
      superBlock,
      opts.parcelMinSize,
      opts.subRoadWidth,
      Math.min(0.5, Math.max(0, opts.splitRatio)),
      subRoad, mask, rows, cols, rng,
    );

    for (const pb of parcelBlocks) {
      let hasCells = false;
      for (let r = pb.y; r < pb.y + pb.h; r++) {
        for (let c = pb.x; c < pb.x + pb.w; c++) {
          // Only paint cells that are in the target mask and not already a main road
          if (r >= 0 && r < rows && c >= 0 && c < cols && mask[r][c] && mainRoad[r][c] === 0) {
            parcels[r][c] = parcelId;
            hasCells = true;
          }
        }
      }
      if (hasCells) {
        nameList.push({ id: parcelId, name: `地块 ${parcelId}` });
      }
      parcelId++;
    }
  }

  return { mainRoad, subRoad, parcels, nameList };
}
