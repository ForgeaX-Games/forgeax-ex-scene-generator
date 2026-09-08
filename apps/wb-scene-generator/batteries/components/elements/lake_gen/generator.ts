/**
 * Lake generation algorithm using randomized flood-fill (Prim-like growth).
 *
 * Each lake starts from a random seed cell and expands by repeatedly picking
 * a random cell from its frontier, creating organic blob-like shapes rather
 * than perfectly circular ones.
 */

export interface LakeResult {
  cells: [number, number][];
  id: number;
  name: string;
}

export interface GenerateOptions {
  targetId: number;
  lakeCount: number;
  lakeSize: number;
  sizeVariance: number;
  minSpacing: number;
  lakeBaseId: number;
  seed: number;
}

// ---------- Helpers ----------

function makeRng(seed: number): () => number {
  let s = (seed === 0 ? Date.now() : seed) >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223;
    return (s >>> 0) / 0x100000000;
  };
}

function get4Neighbors(r: number, c: number, rows: number, cols: number): [number, number][] {
  const out: [number, number][] = [];
  if (r > 0)          out.push([r - 1, c]);
  if (r < rows - 1)   out.push([r + 1, c]);
  if (c > 0)          out.push([r, c - 1]);
  if (c < cols - 1)   out.push([r, c + 1]);
  return out;
}

// ---------- Organic lake growth ----------

/**
 * Grows a lake starting from (startR, startC) by random flood-fill.
 *
 * At each step a random cell is pulled from the frontier, and all of its
 * valid, unoccupied 4-neighbors are immediately claimed and queued.
 * This produces irregular, organic shapes.
 */
function growLake(
  validSet: Set<string>,
  forbiddenSet: Set<string>,
  startR: number,
  startC: number,
  targetSize: number,
  rows: number,
  cols: number,
  rng: () => number
): [number, number][] {
  const startKey = `${startR},${startC}`;
  if (!validSet.has(startKey) || forbiddenSet.has(startKey)) return [];

  const lake = new Set<string>([startKey]);
  const queue: [number, number][] = [[startR, startC]];

  while (queue.length > 0 && lake.size < targetSize) {
    // Pick a random element from the frontier (not always the oldest → organic shape)
    const idx = Math.floor(rng() * queue.length);
    const [r, c] = queue.splice(idx, 1)[0];

    for (const [nr, nc] of get4Neighbors(r, c, rows, cols)) {
      if (lake.size >= targetSize) break;
      const key = `${nr},${nc}`;
      if (!lake.has(key) && validSet.has(key) && !forbiddenSet.has(key)) {
        lake.add(key);
        queue.push([nr, nc]);
      }
    }
  }

  return [...lake].map(k => {
    const [kr, kc] = k.split(",").map(Number);
    return [kr, kc] as [number, number];
  });
}

// ---------- Forbidden zone expansion ----------

/**
 * Returns the set of all cells reachable from `cells` within `spacing`
 * BFS steps. Used to enforce minimum distance between lakes.
 */
function buildForbiddenZone(
  cells: [number, number][],
  rows: number,
  cols: number,
  spacing: number
): Set<string> {
  const forbidden = new Set(cells.map(([r, c]) => `${r},${c}`));
  let frontier: [number, number][] = [...cells];

  for (let d = 0; d < spacing; d++) {
    const next: [number, number][] = [];
    for (const [r, c] of frontier) {
      for (const [nr, nc] of get4Neighbors(r, c, rows, cols)) {
        const key = `${nr},${nc}`;
        if (!forbidden.has(key)) {
          forbidden.add(key);
          next.push([nr, nc]);
        }
      }
    }
    frontier = next;
  }

  return forbidden;
}

// ---------- Main entry ----------

export function generateLakes(grid: number[][], opts: GenerateOptions): LakeResult[] {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return [];

  const rng = makeRng(opts.seed);

  // Collect all valid candidate cells
  const validSet = new Set<string>();
  let maxGridId = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === opts.targetId) validSet.add(`${r},${c}`);
      if (grid[r][c] > maxGridId) maxGridId = grid[r][c];
    }
  }

  // Base ID for lake masks: explicit > 0, otherwise auto (max existing value + 1)
  const baseId = opts.lakeBaseId > 0 ? opts.lakeBaseId : maxGridId + 1;

  const forbiddenSet = new Set<string>();
  const results: LakeResult[] = [];
  let candidates = [...validSet]; // shrinks as cells are forbidden

  for (let i = 0; i < opts.lakeCount; i++) {
    if (candidates.length === 0) break;

    // Pick a valid seed from remaining candidates
    let seedR = -1, seedC = -1;
    const maxAttempts = Math.min(80, candidates.length);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const idx = Math.floor(rng() * candidates.length);
      const key = candidates[idx];
      if (forbiddenSet.has(key)) {
        candidates.splice(idx, 1); // prune stale entries
        continue;
      }
      const [r, c] = key.split(",").map(Number);
      seedR = r; seedC = c;
      break;
    }

    if (seedR === -1) break;

    // Randomise this lake's target size within ±sizeVariance
    const jitter = (rng() * 2 - 1) * opts.sizeVariance;
    const targetSize = Math.max(1, Math.round(opts.lakeSize * (1 + jitter)));

    const cells = growLake(validSet, forbiddenSet, seedR, seedC, targetSize, rows, cols, rng);
    if (cells.length === 0) continue;

    const lakeId = baseId + results.length; // use results.length for consecutive IDs
    results.push({ cells, id: lakeId, name: `湖泊${results.length + 1}` });

    // Forbid lake cells + spacing buffer for future lakes
    const zone = buildForbiddenZone(cells, rows, cols, opts.minSpacing);
    for (const key of zone) forbiddenSet.add(key);

    // Keep candidates list current
    candidates = candidates.filter(k => !forbiddenSet.has(k));
  }

  return results;
}
