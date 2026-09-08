/**
 * park_generator: 在单张区域掩码上生成公园布局（草坪/小径/花圃/树木/水景）（DataTree 形式）
 * 输入：inputGrid (grid/item) — 单张可用区域掩码网格; algorithm (string) — 布局算法;
 *       pathWidth/treeCount/spokeCount (number) — 布局参数; seed (number) — 随机种子
 * 输出：
 *   outputGrid (grid/item) — 单张多值网格（1=草坪，2=小径，3=花圃，4=树木，5=池塘）
 *   outputNameList (array/item) — 名称清单，仅含实际出现的 id，格式 [{id, name, type}]
 * 网格列表由引擎按 DataTree 自动逐张 fanout。
 */

type Grid = number[][];

const LAWN   = 1;
const PATH   = 2;
const GARDEN = 3;
const TREE   = 4;
const WATER  = 5;

function makeLCG(seed: number): () => number {
  let s = ((seed === 0 ? Date.now() : seed) & 0xffffffff) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967295;
  };
}

function getBBox(grid: Grid): { r0: number; r1: number; c0: number; c1: number } | null {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  let r0 = rows, r1 = -1, c0 = cols, c1 = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) {
        if (r < r0) r0 = r;
        if (r > r1) r1 = r;
        if (c < c0) c0 = c;
        if (c > c1) c1 = c;
      }
    }
  }
  return r1 === -1 ? null : { r0, r1, c0, c1 };
}

function fillValid(output: Grid, grid: Grid, r0: number, r1: number, c0: number, c1: number): void {
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++)
      if (grid[r][c] !== 0) output[r][c] = LAWN;
}

// Paint a filled disc; overwritePath=true allows painting over existing PATH cells
function paintDisc(
  output: Grid, grid: Grid, rows: number, cols: number,
  cr: number, cc: number, radius: number, value: number, overwritePath = false,
): void {
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      if (dr * dr + dc * dc <= radius * radius) {
        const nr = cr + dr, nc = cc + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr]?.[nc] !== 0) {
          if (overwritePath || output[nr][nc] !== PATH) output[nr][nc] = value;
        }
      }
    }
  }
}

// Paint a filled ellipse (never overwrites PATH)
function paintEllipse(
  output: Grid, grid: Grid, rows: number, cols: number,
  cr: number, cc: number, rh: number, rv: number, value: number,
): void {
  for (let dr = -rh; dr <= rh; dr++) {
    for (let dc = -rv; dc <= rv; dc++) {
      if ((dr / rh) ** 2 + (dc / rv) ** 2 <= 1) {
        const nr = cr + dr, nc = cc + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr]?.[nc] !== 0 && output[nr][nc] !== PATH) {
          output[nr][nc] = value;
        }
      }
    }
  }
}

// Rasterize a straight line as a PATH stroke of given width
function drawLine(
  output: Grid, grid: Grid, rows: number, cols: number,
  r1: number, c1: number, r2: number, c2: number, lineWidth: number,
): void {
  const steps = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1)) * 2 + 1;
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const r = Math.round(r1 + (r2 - r1) * t);
    const c = Math.round(c1 + (c2 - c1) * t);
    paintDisc(output, grid, rows, cols, r, c, lineWidth, PATH, true);
  }
}

// Scatter TREE markers in open LAWN cells, respecting a minimum separation distance
function scatterTrees(
  output: Grid, grid: Grid, r0: number, r1: number, c0: number, c1: number,
  count: number, minDist: number, rng: () => number,
): void {
  const placed: [number, number][] = [];
  const H = r1 - r0 + 1, W = c1 - c0 + 1;
  for (let a = 0; a < count * 30 && placed.length < count; a++) {
    const r = r0 + Math.floor(rng() * H);
    const c = c0 + Math.floor(rng() * W);
    if (grid[r]?.[c] === 0 || output[r][c] !== LAWN) continue;
    let ok = true;
    for (const [pr, pc] of placed) {
      if ((r - pr) ** 2 + (c - pc) ** 2 < minDist * minDist) { ok = false; break; }
    }
    if (ok) { output[r][c] = TREE; placed.push([r, c]); }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Algorithm 1: organic
// Two crossing sinusoidal paths + elliptical garden beds + water features + trees.
// Resembles the naturalistic park design in the reference image.
// ─────────────────────────────────────────────────────────────────────────────
function generateOrganic(grid: Grid, pathW: number, treeCount: number, rng: () => number): Grid {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const bbox = getBBox(grid);
  if (!bbox) return output;
  const { r0, r1, c0, c1 } = bbox;
  const H = r1 - r0 + 1, W = c1 - c0 + 1;
  const cMid = (c0 + c1) / 2, rMid = (r0 + r1) / 2;

  fillValid(output, grid, r0, r1, c0, c1);

  // Main path: vertical winding with two overlapping sine components
  const A1 = W * (0.15 + rng() * 0.15);
  const A2 = W * 0.07;
  const f1 = 1.0 + rng() * 1.5;
  const f2 = 3.0 + rng() * 2.0;
  const ph1 = rng() * Math.PI * 2, ph2 = rng() * Math.PI * 2;
  for (let r = r0; r <= r1; r++) {
    const t = (r - r0) / Math.max(1, H - 1);
    const c = Math.round(cMid + A1 * Math.sin(t * Math.PI * 2 * f1 + ph1) + A2 * Math.sin(t * Math.PI * 2 * f2 + ph2));
    paintDisc(output, grid, rows, cols, r, c, pathW, PATH, true);
  }

  // Secondary path: horizontal winding
  const A3 = H * (0.10 + rng() * 0.10);
  const f3 = 1.5 + rng() * 1.0;
  const ph3 = rng() * Math.PI * 2;
  for (let c = c0; c <= c1; c++) {
    const t = (c - c0) / Math.max(1, W - 1);
    const r = Math.round(rMid + A3 * Math.sin(t * Math.PI * 2 * f3 + ph3));
    paintDisc(output, grid, rows, cols, r, c, pathW, PATH, true);
  }

  // Elliptical garden beds (4-7 beds scattered in the lawn)
  const numBeds = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < numBeds; i++) {
    const cr = r0 + 3 + Math.floor(rng() * (H - 6));
    const cc = c0 + 3 + Math.floor(rng() * (W - 6));
    if (grid[cr]?.[cc] === 0 || output[cr][cc] === PATH) continue;
    const rh = 2 + Math.floor(rng() * Math.max(1, Math.floor(H * 0.07)));
    const rv = 2 + Math.floor(rng() * Math.max(1, Math.floor(W * 0.07)));
    paintEllipse(output, grid, rows, cols, cr, cc, rh, rv, GARDEN);
  }

  // Water features (1-2 small ellipses)
  const numWater = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < numWater; i++) {
    const wr = r0 + 3 + Math.floor(rng() * (H - 6));
    const wc = c0 + 3 + Math.floor(rng() * (W - 6));
    if (grid[wr]?.[wc] === 0 || output[wr][wc] === PATH || output[wr][wc] === GARDEN) continue;
    const wrh = 2 + Math.floor(rng() * 3);
    const wrv = 2 + Math.floor(rng() * 3);
    paintEllipse(output, grid, rows, cols, wr, wc, wrh, wrv, WATER);
  }

  scatterTrees(output, grid, r0, r1, c0, c1, treeCount, 4, rng);
  return output;
}

// ─────────────────────────────────────────────────────────────────────────────
// Algorithm 2: geometric
// Formal cross-shaped paths dividing the area into four quadrants; each quadrant
// gets a symmetric elliptical garden bed; small water feature at the center.
// ─────────────────────────────────────────────────────────────────────────────
function generateGeometric(grid: Grid, pathW: number, treeCount: number, rng: () => number): Grid {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const bbox = getBBox(grid);
  if (!bbox) return output;
  const { r0, r1, c0, c1 } = bbox;
  const H = r1 - r0 + 1, W = c1 - c0 + 1;
  const rMid = Math.floor((r0 + r1) / 2);
  const cMid = Math.floor((c0 + c1) / 2);

  fillValid(output, grid, r0, r1, c0, c1);

  // Main cross paths
  drawLine(output, grid, rows, cols, r0, cMid, r1, cMid, pathW); // vertical
  drawLine(output, grid, rows, cols, rMid, c0, rMid, c1, pathW); // horizontal

  // Diagonal accent paths from center to corners (optional – creates octagonal feel)
  const diagLen = Math.floor(Math.min(H, W) * 0.28);
  const diags: [number, number, number, number][] = [
    [rMid, cMid, rMid - diagLen, cMid - diagLen],
    [rMid, cMid, rMid - diagLen, cMid + diagLen],
    [rMid, cMid, rMid + diagLen, cMid - diagLen],
    [rMid, cMid, rMid + diagLen, cMid + diagLen],
  ];
  diags.forEach(([r1l, c1l, r2l, c2l]) => drawLine(output, grid, rows, cols, r1l, c1l, r2l, c2l, pathW));

  // Elliptical garden bed in each quadrant
  const margin = pathW + 2;
  const bedH = Math.max(2, Math.floor((H / 2 - margin) * 0.55));
  const bedW = Math.max(2, Math.floor((W / 2 - margin) * 0.55));
  const quadCenters: [number, number][] = [
    [Math.floor((r0 + rMid) / 2), Math.floor((c0 + cMid) / 2)],
    [Math.floor((r0 + rMid) / 2), Math.floor((cMid + c1) / 2)],
    [Math.floor((rMid + r1) / 2), Math.floor((c0 + cMid) / 2)],
    [Math.floor((rMid + r1) / 2), Math.floor((cMid + c1) / 2)],
  ];
  quadCenters.forEach(([cr, cc]) => {
    if (grid[cr]?.[cc] !== 0 && output[cr][cc] !== PATH) {
      paintEllipse(output, grid, rows, cols, cr, cc, bedH, bedW, GARDEN);
    }
  });

  // Water feature at center
  const wSize = Math.max(2, pathW + 1);
  paintEllipse(output, grid, rows, cols, rMid, cMid, wSize, wSize, WATER);

  scatterTrees(output, grid, r0, r1, c0, c1, treeCount, 5, rng);
  return output;
}

// ─────────────────────────────────────────────────────────────────────────────
// Algorithm 3: radial
// Concentric ring paths + N radial spokes from center; circular garden beds between
// spokes in the middle ring; water feature at the center hub.
// ─────────────────────────────────────────────────────────────────────────────
function generateRadial(grid: Grid, pathW: number, treeCount: number, spokeCount: number, rng: () => number): Grid {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const bbox = getBBox(grid);
  if (!bbox) return output;
  const { r0, r1, c0, c1 } = bbox;
  const H = r1 - r0 + 1, W = c1 - c0 + 1;
  const cr = Math.floor((r0 + r1) / 2);
  const cc = Math.floor((c0 + c1) / 2);
  const outerR = Math.floor(Math.min(H, W) * 0.44);
  const innerR = Math.floor(outerR * 0.40);

  fillValid(output, grid, r0, r1, c0, c1);

  // Outer concentric ring
  for (let i = 0; i < outerR * 24; i++) {
    const angle = (i / (outerR * 24)) * Math.PI * 2;
    const r = Math.round(cr + outerR * Math.sin(angle));
    const c = Math.round(cc + outerR * Math.cos(angle));
    paintDisc(output, grid, rows, cols, r, c, pathW, PATH, true);
  }

  // Inner concentric ring
  for (let i = 0; i < innerR * 24; i++) {
    const angle = (i / (innerR * 24)) * Math.PI * 2;
    const r = Math.round(cr + innerR * Math.sin(angle));
    const c = Math.round(cc + innerR * Math.cos(angle));
    paintDisc(output, grid, rows, cols, r, c, pathW, PATH, true);
  }

  // Radial spokes (from center to outer ring)
  const sc = Math.max(3, Math.min(spokeCount, 8));
  for (let s = 0; s < sc; s++) {
    const angle = (s / sc) * Math.PI * 2;
    const er = Math.round(cr + outerR * Math.sin(angle));
    const ec = Math.round(cc + outerR * Math.cos(angle));
    drawLine(output, grid, rows, cols, cr, cc, er, ec, pathW);
  }

  // Water at center hub
  const hubR = Math.max(2, innerR - pathW - 3);
  if (hubR >= 2) paintEllipse(output, grid, rows, cols, cr, cc, hubR, hubR, WATER);

  // Circular garden beds between spokes (in the mid-ring zone)
  const midR = (innerR + outerR) / 2;
  const bedSize = Math.max(2, Math.floor((outerR - innerR) * 0.25));
  for (let s = 0; s < sc; s++) {
    const angle = ((s + 0.5) / sc) * Math.PI * 2;
    const br = Math.round(cr + midR * Math.sin(angle));
    const bc = Math.round(cc + midR * Math.cos(angle));
    if (grid[br]?.[bc] !== 0) paintEllipse(output, grid, rows, cols, br, bc, bedSize, bedSize, GARDEN);
  }

  scatterTrees(output, grid, r0, r1, c0, c1, treeCount, 5, rng);
  return output;
}

interface NameEntry {
  id: number;
  name: string;
  type: string;
}

// Semantic label map for park_generator values
const PARK_LABELS: Record<number, string> = {
  1: "草坪",
  2: "小径",
  3: "花圃",
  4: "树木",
  5: "池塘",
};

// Values that should be output as "asset" type (point-object placements)
const PARK_ASSET_VALS = new Set([4]); // 树木 = asset

function isGrid(v: unknown): v is Grid {
  return Array.isArray(v) && Array.isArray((v as unknown[])[0]) &&
    typeof (v as Grid)[0]?.[0] === "number";
}

// Build the name list for the values actually present in the multi-value grid.
function buildNameList(multiGrid: Grid): NameEntry[] {
  const valSet = new Set<number>();
  for (const row of multiGrid) for (const v of row) if (v !== 0) valSet.add(v);
  return [...valSet].sort((a, b) => a - b).map((val) => ({
    id: val,
    name: PARK_LABELS[val] ?? `类型${val}`,
    type: PARK_ASSET_VALS.has(val) ? "asset" : "tile",
  }));
}

export function parkGenerator(input: Record<string, unknown>): Record<string, unknown> {
  const rawGrid     = input.inputGrid;
  const algorithm   = typeof input.algorithm  === "string" ? input.algorithm  : "organic";
  const pathWidth   = typeof input.pathWidth  === "number" ? Math.max(1, Math.floor(input.pathWidth))  : 2;
  const treeCount   = typeof input.treeCount  === "number" ? Math.max(0, Math.floor(input.treeCount))  : 20;
  const spokeCount  = typeof input.spokeCount === "number" ? Math.max(3, Math.min(8, Math.floor(input.spokeCount))) : 6;
  const seed        = typeof input.seed       === "number" ? Math.floor(input.seed) : 0;

  if (!isGrid(rawGrid) || rawGrid.length === 0 || !rawGrid[0] || rawGrid[0].length === 0) {
    return { error: "inputGrid is required" };
  }
  const grid = rawGrid as Grid;

  const baseSeed = seed === 0 ? Date.now() : seed;
  const rng = makeLCG(baseSeed);
  let multiGrid: Grid;
  switch (algorithm) {
    case "geometric":
      multiGrid = generateGeometric(grid, pathWidth, treeCount, rng);
      break;
    case "radial":
      multiGrid = generateRadial(grid, pathWidth, treeCount, spokeCount, rng);
      break;
    default: // "organic"
      multiGrid = generateOrganic(grid, pathWidth, treeCount, rng);
  }

  return { outputGrid: multiGrid, outputNameList: buildNameList(multiGrid) };
}
