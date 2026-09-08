/**
 * wfc_tile_solver: Wave Function Collapse for tile-based map assembly.
 * Given NxN tile templates and per-template adjacency rules,
 * collapses a grid of cells into valid tile placements,
 * then stitches the result into a single output grid.
 */

class LCG {
  private s: bigint;
  constructor(seed: number) {
    this.s = BigInt(seed > 0 ? seed : 48271);
  }
  next(): bigint {
    this.s =
      (this.s * 6364136223846793005n + 1442695040888963407n) &
      0xffffffffffffffffn;
    return this.s;
  }
  float01(): number {
    return Number((this.next() >> 33n) % 1000000n) / 1000000;
  }
}

type Dir = "N" | "S" | "E" | "W";
const DIRS: Dir[] = ["N", "S", "E", "W"];
const DR: Record<Dir, number> = { N: -1, S: 1, E: 0, W: 0 };
const DC: Record<Dir, number> = { N: 0, S: 0, E: 1, W: -1 };

interface AdjRule {
  N: Set<number>;
  S: Set<number>;
  E: Set<number>;
  W: Set<number>;
}

// ── WFC single attempt ──

function wfcAttempt(
  nTmpl: number,
  adj: AdjRule[],
  rows: number,
  cols: number,
  weights: number[],
  rng: LCG,
): number[][] | null {
  // possible[r][c] = set of template indices still valid for that cell
  const possible: Set<number>[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => {
      const s = new Set<number>();
      for (let i = 0; i < nTmpl; i++) s.add(i);
      return s;
    }),
  );

  function propagate(seedCells: [number, number][]): boolean {
    const queue = seedCells.slice();
    const inQ = new Set<number>();
    for (const [r, c] of queue) inQ.add(r * cols + c);
    let head = 0;

    while (head < queue.length) {
      const [r, c] = queue[head++];
      inQ.delete(r * cols + c);

      for (const d of DIRS) {
        const nr = r + DR[d];
        const nc = c + DC[d];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

        const allowed = new Set<number>();
        for (const t of possible[r][c]) {
          for (const a of adj[t][d]) allowed.add(a);
        }

        const nbr = possible[nr][nc];
        const toRemove: number[] = [];
        for (const t of nbr) {
          if (!allowed.has(t)) toRemove.push(t);
        }
        if (toRemove.length === 0) continue;
        for (const t of toRemove) nbr.delete(t);

        if (nbr.size === 0) return false;

        const key = nr * cols + nc;
        if (!inQ.has(key)) {
          queue.push([nr, nc]);
          inQ.add(key);
        }
      }
    }
    return true;
  }

  function minEntropyCell(): [number, number] {
    let bestE = Infinity;
    let bestR = -1, bestC = -1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const n = possible[r][c].size;
        if (n <= 1) continue;
        // Bias toward cells adjacent to already-collapsed cells
        let adjCollapsed = 0;
        for (const d of DIRS) {
          const nr = r + DR[d], nc = c + DC[d];
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols
              && possible[nr][nc].size === 1) {
            adjCollapsed++;
          }
        }
        const e = n - adjCollapsed * 0.4 + rng.float01() * 0.1;
        if (e < bestE) { bestE = e; bestR = r; bestC = c; }
      }
    }
    return [bestR, bestC];
  }

  function collapse(r: number, c: number): void {
    const tiles = Array.from(possible[r][c]);
    const w = tiles.map((t) => weights[t]);
    const total = w.reduce((a, b) => a + b, 0);
    let pick = rng.float01() * total;
    let chosen = tiles[tiles.length - 1];
    for (let i = 0; i < tiles.length; i++) {
      pick -= w[i];
      if (pick <= 0) { chosen = tiles[i]; break; }
    }
    possible[r][c] = new Set([chosen]);
  }

  // Main WFC loop
  for (;;) {
    const [r, c] = minEntropyCell();
    if (r < 0) break;
    collapse(r, c);
    if (!propagate([[r, c]])) return null;
  }

  // Verify every cell is fully collapsed; otherwise treat as failure so the
  // outer attempt-loop can retry instead of silently filling templates[0].
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (possible[r][c].size !== 1) return null;
    }
  }

  const result: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      const s = possible[r][c];
      row.push(s.values().next().value as number);
    }
    result.push(row);
  }
  return result;
}

// ── Stitch templates into output grid ──

function stitchGrid(
  solution: number[][],
  templates: number[][][],
  tileH: number,
  tileW: number,
): number[][] {
  const rows = solution.length;
  const cols = solution[0].length;
  const grid: number[][] = Array.from(
    { length: rows * tileH },
    () => new Array(cols * tileW).fill(0),
  );
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = solution[r][c];
      if (idx < 0 || idx >= templates.length) continue;
      const tmpl = templates[idx];
      const oy = r * tileH;
      const ox = c * tileW;
      for (let ty = 0; ty < tileH && ty < tmpl.length; ty++) {
        for (let tx = 0; tx < tileW && tx < tmpl[ty].length; tx++) {
          grid[oy + ty][ox + tx] = tmpl[ty][tx];
        }
      }
    }
  }
  return grid;
}

// ── Default demo: 16 Diablo-style dungeon tiles (7×7, 0=wall 1=floor) ──

const DEMO_DEFS = [
  "S", "SE", "NS", "NEW",
  "N", "NE", "EW", "NSW",
  "W", "NW", "NSEW", "SEW",
  "E", "SW", "Fill", "NSE",
];

function demoHasOpening(def: string, d: string): boolean {
  return def !== "Fill" && def.includes(d);
}

function buildDefaultDemo(): {
  templates: number[][][]; adj: AdjRule[]; weights: number[];
} {
  const S = 7, RS = 2, RE = 5;

  function makeTile(def: string): number[][] {
    const g: number[][] = Array.from({ length: S }, () => new Array(S).fill(0));
    if (def === "Fill") return g;
    for (let y = RS; y < RE; y++)
      for (let x = RS; x < RE; x++) g[y][x] = 1;
    if (demoHasOpening(def, "N"))
      for (let y = 0; y < RS; y++)
        for (let x = RS; x < RE; x++) g[y][x] = 1;
    if (demoHasOpening(def, "S"))
      for (let y = RE; y < S; y++)
        for (let x = RS; x < RE; x++) g[y][x] = 1;
    if (demoHasOpening(def, "W"))
      for (let y = RS; y < RE; y++)
        for (let x = 0; x < RS; x++) g[y][x] = 1;
    if (demoHasOpening(def, "E"))
      for (let y = RS; y < RE; y++)
        for (let x = RE; x < S; x++) g[y][x] = 1;
    return g;
  }

  const opp: Record<string, Dir> = { N: "S", S: "N", E: "W", W: "E" };
  const templates = DEMO_DEFS.map(makeTile);
  const adj: AdjRule[] = DEMO_DEFS.map((me) => {
    const rule: AdjRule = { N: new Set(), S: new Set(), E: new Set(), W: new Set() };
    for (const d of DIRS) {
      for (let j = 0; j < DEMO_DEFS.length; j++) {
        if (demoHasOpening(me, d) === demoHasOpening(DEMO_DEFS[j], opp[d])) {
          rule[d].add(j);
        }
      }
    }
    return rule;
  });

  const weights = DEMO_DEFS.map((def) => {
    if (def === "Fill") return 0.3;
    const n = DIRS.filter((d) => demoHasOpening(def, d)).length;
    return n === 1 ? 1.5 : n === 2 ? 4.0 : n === 3 ? 3.0 : 2.5;
  });

  return { templates, adj, weights };
}

// ── Input parsing helpers ──

function parseIdxSet(raw: unknown, max: number): Set<number> {
  const s = new Set<number>();
  if (!Array.isArray(raw)) return s;
  for (const v of raw) {
    const n = Math.floor(Number(v));
    if (!isNaN(n) && n >= 0 && n < max) s.add(n);
  }
  return s;
}

function parseAdjacency(raw: unknown, n: number): AdjRule[] | null {
  if (!Array.isArray(raw) || raw.length !== n) return null;
  const result: AdjRule[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const obj = item as Record<string, unknown>;
    result.push({
      N: parseIdxSet(obj.N, n),
      S: parseIdxSet(obj.S, n),
      E: parseIdxSet(obj.E, n),
      W: parseIdxSet(obj.W, n),
    });
  }
  return result;
}

// ── Main export ──

export function wfcTileSolver(
  input: Record<string, unknown>,
): Record<string, unknown> {
  let templates: number[][][];
  let adj: AdjRule[];
  let weights: number[];

  const rawTemplates = input.templates;
  const rawAdj = input.adjacency;
  const useDemo =
    (!Array.isArray(rawTemplates) || rawTemplates.length === 0) &&
    (!Array.isArray(rawAdj) || rawAdj.length === 0);

  if (useDemo) {
    const demo = buildDefaultDemo();
    templates = demo.templates;
    adj = demo.adj;
    weights = demo.weights;
  } else {
    if (!Array.isArray(rawTemplates) || rawTemplates.length === 0) {
      return { error: "templates is required (non-empty array of 2D grids)" };
    }
    templates = [];
    for (const t of rawTemplates) {
      if (!Array.isArray(t) || !Array.isArray(t[0])) {
        return { error: "Each template must be a 2D number array" };
      }
      templates.push(t as number[][]);
    }

    const parsedAdj = parseAdjacency(rawAdj, templates.length);
    if (!parsedAdj) {
      return { error: `adjacency must be an array of ${templates.length} objects with N/S/E/W keys` };
    }
    adj = parsedAdj;

    const rawW = input.weights;
    weights = [];
    if (Array.isArray(rawW) && rawW.length === templates.length) {
      for (let i = 0; i < templates.length; i++) {
        weights.push(Math.max(0.01, Number(rawW[i]) || 1));
      }
    } else {
      for (let i = 0; i < templates.length; i++) weights.push(1);
    }
  }

  const nTmpl = templates.length;
  const tileH = templates[0].length;
  const tileW = templates[0][0].length;

  const rows = Math.max(1, Math.min(64, Math.floor(Number(input.rows) || 8)));
  const cols = Math.max(1, Math.min(64, Math.floor(Number(input.cols) || 8)));
  const maxRetries = Math.max(1, Math.min(200, Math.floor(Number(input.maxRetries) || 50)));
  const seed = Math.floor(Number(input.seed) || 0);

  let best: number[][] | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const rng = new LCG(seed > 0 ? seed + attempt : attempt + 1);
    const result = wfcAttempt(nTmpl, adj, rows, cols, weights, rng);
    if (result) { best = result; break; }
  }

  if (!best) {
    return { error: `WFC failed after ${maxRetries} attempts. Check adjacency rules for consistency.` };
  }

  const grid = stitchGrid(best, templates, tileH, tileW);
  return { grid };
}
