/**
 * fence_farm: 在单张区域掩码上生成农场栅栏与栅栏门布局（DataTree 形式）
 * 输入：inputGrid (grid/item) — 单张可用区域掩码网格; fenceMode (string) — 栅栏形式;
 *       gateCount/sectionCount/gateWidth/plotWidth/plotHeight (number) — 布局参数
 * 输出：
 *   outputGrid (grid/item) — 单张多值网格（1=内部地面，2=栅栏，3=栅栏门）
 *   outputNameList (array/item) — 名称清单，仅含实际出现的 id，格式 [{id, name, type}]
 * 网格列表由引擎按 DataTree 自动逐张 fanout。
 */

type Grid = number[][];

const INTERIOR = 1; // walkable interior ground
const FENCE    = 2; // fence (impassable)
const GATE     = 3; // gate (passable opening in fence)

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

// Fill the bounding-box-relative border ring with FENCE, interior with INTERIOR.
function applyBorderFence(
  output: Grid,
  grid: Grid,
  r0: number, r1: number, c0: number, c1: number,
): void {
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (grid[r][c] === 0) continue;
      output[r][c] = (r === r0 || r === r1 || c === c0 || c === c1) ? FENCE : INTERIOR;
    }
  }
}

// --- Algorithm 1: border ---
// Single outer perimeter fence with up to 4 gates, one per side at the center.
//   gateCount 1→top, 2→top+bottom, 3→top+right+bottom, 4→all four sides.
function generateBorder(grid: Grid, gateCount: number): Grid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  const bbox = getBBox(grid);
  if (!bbox) return output;
  const { r0, r1, c0, c1 } = bbox;

  applyBorderFence(output, grid, r0, r1, c0, c1);

  const cMid = Math.floor((c0 + c1) / 2);
  const rMid = Math.floor((r0 + r1) / 2);

  // Gate positions clockwise: top, right, bottom, left
  const gateCells: [number, number][] = [
    [r0,   cMid],
    [rMid, c1  ],
    [r1,   cMid],
    [rMid, c0  ],
  ];

  const n = Math.min(Math.max(1, gateCount), 4);
  for (let i = 0; i < n; i++) {
    const [gr, gc] = gateCells[i];
    if (grid[gr]?.[gc] !== 0) output[gr][gc] = GATE;
  }

  return output;
}

// --- Algorithm 2: sections ---
// Outer border fence + dividing fences that split the area into equal sections.
// Orientation is randomly horizontal or vertical per grid.
// Each divider has a gate of configurable width, centered on the perpendicular axis.
// Outer border always has gates on both ends so the farm is accessible from outside.
function generateSections(grid: Grid, sectionCount: number, gateWidth: number, rng: () => number): Grid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  const bbox = getBBox(grid);
  if (!bbox) return output;
  const { r0, r1, c0, c1 } = bbox;

  applyBorderFence(output, grid, r0, r1, c0, c1);

  const halfGate = Math.floor((gateWidth - 1) / 2);
  const vertical = rng() < 0.5; // randomly pick horizontal or vertical split

  if (vertical) {
    // Vertical dividers — split by columns
    const totalW = c1 - c0 + 1;
    const sc = Math.max(2, Math.min(sectionCount, Math.floor(totalW / 3)));
    const sectionW = Math.floor(totalW / sc);
    const rMid = Math.floor((r0 + r1) / 2);

    // Outer gates: left and right borders, centered vertically
    for (let r = r0; r <= r1; r++) {
      if (grid[r]?.[c0] !== 0 && Math.abs(r - rMid) <= halfGate) output[r][c0] = GATE;
      if (grid[r]?.[c1] !== 0 && Math.abs(r - rMid) <= halfGate) output[r][c1] = GATE;
    }

    // Interior vertical dividers with centered gates
    for (let s = 1; s < sc; s++) {
      const divC = c0 + s * sectionW;
      if (divC >= c1) break;
      for (let r = r0; r <= r1; r++) {
        if (grid[r]?.[divC] === 0) continue;
        output[r][divC] = Math.abs(r - rMid) <= halfGate ? GATE : FENCE;
      }
    }
  } else {
    // Horizontal dividers — split by rows
    const totalH = r1 - r0 + 1;
    const sc = Math.max(2, Math.min(sectionCount, Math.floor(totalH / 3)));
    const sectionH = Math.floor(totalH / sc);
    const cMid = Math.floor((c0 + c1) / 2);

    // Outer gates: top and bottom borders, centered horizontally
    for (let c = c0; c <= c1; c++) {
      if (grid[r0]?.[c] !== 0 && Math.abs(c - cMid) <= halfGate) output[r0][c] = GATE;
      if (grid[r1]?.[c] !== 0 && Math.abs(c - cMid) <= halfGate) output[r1][c] = GATE;
    }

    // Interior horizontal dividers with centered gates
    for (let s = 1; s < sc; s++) {
      const divR = r0 + s * sectionH;
      if (divR >= r1) break;
      for (let c = c0; c <= c1; c++) {
        if (grid[divR]?.[c] === 0) continue;
        output[divR][c] = Math.abs(c - cMid) <= halfGate ? GATE : FENCE;
      }
    }
  }

  return output;
}

// --- Algorithm 3: plots ---
// Evenly-distributed fenced rectangular enclosures.
// Fence lines are spaced so that r0/c0 and r1/c1 are always fence lines,
// making all plots roughly equal-sized with no tiny edge remnants.
// plotW/plotH are approximate targets; actual size may vary by ±1 cell.
function generatePlots(grid: Grid, plotW: number, plotH: number): Grid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  const bbox = getBBox(grid);
  if (!bbox) return output;
  const { r0, r1, c0, c1 } = bbox;

  const totalH = r1 - r0 + 1;
  const totalW = c1 - c0 + 1;

  // Number of plots: round to nearest whole number, at least 1
  const numPlotsR = Math.max(1, Math.round(totalH / (plotH + 1)));
  const numPlotsC = Math.max(1, Math.round(totalW / (plotW + 1)));

  // Evenly spaced fence-line positions (always includes r0/r1 and c0/c1)
  const fenceRows: number[] = [];
  for (let i = 0; i <= numPlotsR; i++) {
    fenceRows.push(r0 + Math.round(i * (totalH - 1) / numPlotsR));
  }
  const fenceCols: number[] = [];
  for (let i = 0; i <= numPlotsC; i++) {
    fenceCols.push(c0 + Math.round(i * (totalW - 1) / numPlotsC));
  }

  const fenceRowSet = new Set(fenceRows);
  const fenceColSet = new Set(fenceCols);

  const gateSet = new Set<string>();

  // Outer gate: top border (fenceRows[0]), centered in the middle plot column span
  const midColIdx = Math.floor(numPlotsC / 2);
  const outerGateCol = Math.round((fenceCols[midColIdx] + fenceCols[midColIdx + 1]) / 2);
  gateSet.add(`${fenceRows[0]},${outerGateCol}`);

  // Interior horizontal gates: one per plot column span on each interior fence row
  // → allows moving between plot rows within the same column
  for (let ri = 1; ri < fenceRows.length - 1; ri++) {
    const fr = fenceRows[ri];
    for (let ci = 0; ci < fenceCols.length - 1; ci++) {
      const gateCol = Math.round((fenceCols[ci] + fenceCols[ci + 1]) / 2);
      gateSet.add(`${fr},${gateCol}`);
    }
  }

  // Interior vertical gates: one per plot row span on each interior fence column
  // → allows moving between adjacent plot columns, ensuring full connectivity
  for (let ci = 1; ci < fenceCols.length - 1; ci++) {
    const fc = fenceCols[ci];
    for (let ri = 0; ri < fenceRows.length - 1; ri++) {
      const gateRow = Math.round((fenceRows[ri] + fenceRows[ri + 1]) / 2);
      gateSet.add(`${gateRow},${fc}`);
    }
  }

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (grid[r][c] === 0) continue;
      const onFenceR = fenceRowSet.has(r);
      const onFenceC = fenceColSet.has(c);
      if (onFenceR || onFenceC) {
        output[r][c] = gateSet.has(`${r},${c}`) ? GATE : FENCE;
      } else {
        output[r][c] = INTERIOR;
      }
    }
  }

  return output;
}

// Simple seeded LCG random number generator (returns values in [0, 1))
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || Date.now();
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

interface NameEntry {
  id: number;
  name: string;
  type: string;
}

// Semantic label map for fence_farm values
const FENCE_LABELS: Record<number, string> = {
  1: "内部地面",
  2: "栅栏",
  3: "栅栏门",
};

// Values that should be output as "asset" type (point/object placements)
const FENCE_ASSET_VALS = new Set([3]); // 栅栏门 = asset

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
    name: FENCE_LABELS[val] ?? `类型${val}`,
    type: FENCE_ASSET_VALS.has(val) ? "asset" : "tile",
  }));
}

export function fenceFarm(input: Record<string, unknown>): Record<string, unknown> {
  const rawGrid      = input.inputGrid;
  const fenceMode    = typeof input.fenceMode    === "string" ? input.fenceMode    : "border";
  const gateCount    = typeof input.gateCount    === "number" ? Math.max(1, Math.min(4, Math.floor(input.gateCount)))   : 2;
  const sectionCount = typeof input.sectionCount === "number" ? Math.max(2, Math.floor(input.sectionCount))             : 3;
  const gateWidth    = typeof input.gateWidth    === "number" ? Math.max(1, Math.floor(input.gateWidth))                : 2;
  const plotWidth    = typeof input.plotWidth    === "number" ? Math.max(2, Math.floor(input.plotWidth))                : 8;
  const plotHeight   = typeof input.plotHeight   === "number" ? Math.max(2, Math.floor(input.plotHeight))               : 8;
  const seed         = typeof input.seed         === "number" ? Math.floor(input.seed)                                  : 0;

  if (!isGrid(rawGrid) || rawGrid.length === 0 || !rawGrid[0] || rawGrid[0].length === 0) {
    return { error: "inputGrid is required" };
  }
  const grid = rawGrid as Grid;

  const rng = makeRng(seed);
  let multiGrid: Grid;
  switch (fenceMode) {
    case "sections":
      multiGrid = generateSections(grid, sectionCount, gateWidth, rng);
      break;
    case "plots":
      multiGrid = generatePlots(grid, plotWidth, plotHeight);
      break;
    default: // "border"
      multiGrid = generateBorder(grid, gateCount);
  }

  return { outputGrid: multiGrid, outputNameList: buildNameList(multiGrid) };
}
