/**
 * shrine_layout: 在单张区域掩码上生成神殿/空地/竞技场布局（DataTree 形式）
 * 输入：inputGrid (grid/item) — 单张区域掩码网格; algorithm (string) — 布局类型;
 *       decorCount (number) — 装饰点数量; pathWidth (number) — 十字厅墙厚度
 *       seed (number) — 随机种子（0 = 使用随机值）
 * 输出：
 *   outputGrid (grid/item) — 单张多值网格（1=外围墙，2=地板，3=中心焦点区，4=神坛祭台，5=装饰位）
 *   outputNameList (array/item) — 名称清单，仅含实际出现的 id，格式 [{id, name, type}]
 * 祭坛方向：每张网格随机朝向 上/右/下/左 四方向之一；网格列表由引擎按 DataTree 自动逐张 fanout。
 */

type Grid = number[][];

const OUTER  = 1; // outer terrain / wall ring
const FLOOR  = 2; // main walkable floor
const CENTER = 3; // center focal zone (campfire / combat circle / ritual spot)
const ALTAR  = 4; // altar / shrine zone
const DECO   = 5; // decoration placement positions (columns, torches, stones…)

// Simple seeded LCG random (returns float in [0,1))
function makeLCG(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function getBBox(grid: Grid): { r0: number; r1: number; c0: number; c1: number } | null {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  let r0 = rows, r1 = -1, c0 = cols, c1 = -1;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] !== 0) {
        if (r < r0) r0 = r; if (r > r1) r1 = r;
        if (c < c0) c0 = c; if (c > c1) c1 = c;
      }
  return r1 === -1 ? null : { r0, r1, c0, c1 };
}

function mark(output: Grid, grid: Grid, r: number, c: number, value: number): void {
  const rows = output.length, cols = output[0]?.length ?? 0;
  if (r < 0 || r >= rows || c < 0 || c >= cols || grid[r]?.[c] === 0) return;
  const cur = output[r][c];
  if (cur === ALTAR || cur === CENTER) return;
  output[r][c] = value;
}

// Place DECO at N equidistant points on a circle of given radius (starts from 12 o'clock)
function placeDecoRing(
  output: Grid, grid: Grid, cr: number, cc: number,
  radius: number, count: number,
): void {
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (i / count) * Math.PI * 2;
    mark(output, grid, Math.round(cr + radius * Math.sin(angle)), Math.round(cc + radius * Math.cos(angle)), DECO);
  }
}

// Returns altar center offset vector [dr, dc] and whether to swap aH/aW
// dir: 0=north/up, 1=east/right, 2=south/down, 3=west/left
function dirVec(dir: number): [number, number] {
  switch (dir % 4) {
    case 0: return [-1,  0]; // north
    case 1: return [ 0,  1]; // east
    case 2: return [ 1,  0]; // south
    case 3: return [ 0, -1]; // west
    default: return [-1,  0];
  }
}

// Place altar rectangle: center at (aCR, aCC), half-extents (aHh, aWh)
function placeAltar(
  output: Grid, r0: number, r1: number, c0: number, c1: number,
  aCR: number, aCC: number, aHh: number, aWh: number,
): void {
  for (let r = Math.floor(aCR - aHh); r <= Math.ceil(aCR + aHh); r++)
    for (let c = Math.floor(aCC - aWh); c <= Math.ceil(aCC + aWh); c++)
      if (r >= r0 && r <= r1 && c >= c0 && c <= c1 && output[r]?.[c] === FLOOR)
        output[r][c] = ALTAR;
}

// ─── Algorithm 1: clearing ────────────────────────────────────────────────────
function generateClearing(grid: Grid, decorCount: number, dir: number): Grid {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const bbox = getBBox(grid);
  if (!bbox) return output;
  const { r0, r1, c0, c1 } = bbox;
  const H = r1 - r0 + 1, W = c1 - c0 + 1;
  const cr = (r0 + r1) / 2, cc = (c0 + c1) / 2;
  const floorR = Math.max(4, Math.floor(Math.min(H, W) * 0.42));

  // 1. Outer terrain
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++)
      if (grid[r][c] !== 0) output[r][c] = OUTER;

  // 2. Circular floor disc
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++)
      if (grid[r][c] !== 0 && (r - cr) ** 2 + (c - cc) ** 2 <= floorR * floorR)
        output[r][c] = FLOOR;

  // 3. Altar: rectangular zone in direction `dir` from center
  const [dr, dc] = dirVec(dir);
  // aDepth = dimension along movement axis; aSpan = perpendicular
  const aDepth = Math.max(2, Math.floor(floorR * 0.28));
  const aSpan  = Math.max(3, Math.floor(floorR * 0.52));
  const aHh = (dr !== 0 ? aDepth : aSpan) / 2; // half row-extent
  const aWh = (dr !== 0 ? aSpan  : aDepth) / 2; // half col-extent
  const aCR = cr + dr * floorR * 0.60;
  const aCC = cc + dc * floorR * 0.60;
  placeAltar(output, r0, r1, c0, c1, aCR, aCC, aHh, aWh);

  // 4. Center focal point (slightly opposite to altar direction)
  const fcR = Math.round(cr - dr * floorR * 0.08);
  const fcC = Math.round(cc - dc * floorR * 0.08);
  if (output[fcR]?.[fcC] === FLOOR) output[fcR][fcC] = CENTER;

  // 5. Perimeter decoration ring
  placeDecoRing(output, grid, cr, cc, Math.floor(floorR * 0.78), Math.max(4, Math.min(decorCount, 12)));

  return output;
}

// ─── Algorithm 2: cruciform ───────────────────────────────────────────────────
function generateCruciform(grid: Grid, wallThickness: number, dir: number): Grid {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const bbox = getBBox(grid);
  if (!bbox) return output;
  const { r0, r1, c0, c1 } = bbox;
  const H = r1 - r0 + 1, W = c1 - c0 + 1;
  const rMid = Math.floor((r0 + r1) / 2), cMid = Math.floor((c0 + c1) / 2);
  const wW = Math.max(1, wallThickness);

  // 1. Outer wall
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++)
      if (grid[r][c] !== 0) output[r][c] = OUTER;

  // 2. Interior floor (inset by wall thickness)
  for (let r = r0 + wW; r <= r1 - wW; r++)
    for (let c = c0 + wW; c <= c1 - wW; c++)
      if (grid[r][c] !== 0) output[r][c] = FLOOR;

  // 3. Altar: alcove in direction `dir` (roughly 22% depth × 35% span of interior)
  const [dr, dc] = dirVec(dir);
  const intH = H - 2 * wW, intW = W - 2 * wW;
  if (dr !== 0) {
    // north/south: horizontal altar strip
    const aDepth = Math.floor(intH * 0.22);
    const aHalf  = Math.floor(intW * 0.17);
    const rFrom  = dr < 0 ? r0 + wW : r1 - wW - aDepth;
    const rTo    = rFrom + aDepth;
    for (let r = rFrom; r <= rTo; r++)
      for (let c = cMid - aHalf; c <= cMid + aHalf; c++)
        if (c >= c0 + wW && c <= c1 - wW && output[r]?.[c] === FLOOR)
          output[r][c] = ALTAR;
  } else {
    // east/west: vertical altar strip
    const aDepth = Math.floor(intW * 0.22);
    const aHalf  = Math.floor(intH * 0.17);
    const cFrom  = dc > 0 ? c1 - wW - aDepth : c0 + wW;
    const cTo    = cFrom + aDepth;
    for (let r = rMid - aHalf; r <= rMid + aHalf; r++)
      for (let c = cFrom; c <= cTo; c++)
        if (r >= r0 + wW && r <= r1 - wW && output[r]?.[c] === FLOOR)
          output[r][c] = ALTAR;
  }

  // 4. Center focal point
  if (output[rMid]?.[cMid] === FLOOR) output[rMid][cMid] = CENTER;

  // 5. Decoration positions: 8 symmetric positions, rotated by direction
  const armR  = Math.floor(Math.min(H, W) * 0.22);
  const armN  = Math.floor(W * 0.12);  // near (toward altar side)
  const sideF = Math.floor(W * 0.35);  // far sides

  // Build positions in canonical frame (north=up), then rotate
  const canonical: [number, number][] = [
    [-armR,                  -armN ],
    [-armR,                   armN ],
    [0,                      -sideF],
    [0,                       sideF],
    [-Math.floor(armR * 0.6), -sideF],
    [-Math.floor(armR * 0.6),  sideF],
    [ Math.floor(armR * 0.6), -sideF],
    [ Math.floor(armR * 0.6),  sideF],
  ];
  // Rotate [dr_local, dc_local] by `dir` quarter-turns CW
  const rotCW = (r: number, c: number, turns: number): [number, number] => {
    let [rr, cc2] = [r, c];
    for (let i = 0; i < turns % 4; i++) [rr, cc2] = [cc2, -rr];
    return [rr, cc2];
  };
  canonical.forEach(([lr, lc]) => {
    const [rr, rc] = rotCW(lr, lc, dir);
    const dr2 = rMid + rr, dc2 = cMid + rc;
    if (dr2 >= r0 && dr2 <= r1 && dc2 >= c0 && dc2 <= c1 && output[dr2]?.[dc2] === FLOOR)
      output[dr2][dc2] = DECO;
  });

  return output;
}

// ─── Algorithm 3: arena ───────────────────────────────────────────────────────
function generateArena(grid: Grid, decorCount: number, dir: number): Grid {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const bbox = getBBox(grid);
  if (!bbox) return output;
  const { r0, r1, c0, c1 } = bbox;
  const H = r1 - r0 + 1, W = c1 - c0 + 1;
  const cr = (r0 + r1) / 2, cc = (c0 + c1) / 2;
  const outerR   = Math.max(5, Math.floor(Math.min(H, W) * 0.46));
  const wallThick = Math.max(2, Math.floor(outerR * 0.17));
  const innerR   = outerR - wallThick;
  const centerZR = Math.max(2, Math.floor(innerR * 0.28));

  // 1. Fill valid area as OUTER
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++)
      if (grid[r][c] !== 0) output[r][c] = OUTER;

  // 2. Inner arena floor (within innerR)
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++)
      if (grid[r][c] !== 0 && (r - cr) ** 2 + (c - cc) ** 2 <= innerR * innerR)
        output[r][c] = FLOOR;

  // 3. Altar: rectangular zone in direction `dir`
  const [dr, dc] = dirVec(dir);
  const aDepth = Math.max(2, Math.floor(innerR * 0.32));
  const aSpan  = Math.max(3, Math.floor(innerR * 0.50));
  const aHh = (dr !== 0 ? aDepth : aSpan) / 2;
  const aWh = (dr !== 0 ? aSpan  : aDepth) / 2;
  const aCR = cr + dr * innerR * 0.58;
  const aCC = cc + dc * innerR * 0.58;
  placeAltar(output, r0, r1, c0, c1, aCR, aCC, aHh, aWh);

  // 4. Center ritual zone (small disc at geometric center)
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++)
      if (output[r]?.[c] === FLOOR && (r - cr) ** 2 + (c - cc) ** 2 <= centerZR * centerZR)
        output[r][c] = CENTER;

  // 5. Decoration ring on the inner face of the outer wall
  const decoR = Math.floor(outerR - wallThick * 0.42);
  placeDecoRing(output, grid, cr, cc, decoR, Math.max(4, Math.min(decorCount, 12)));

  return output;
}

interface NameEntry {
  id: number;
  name: string;
  type: string;
}

// Base semantic label map for shrine_layout values (decoration overridden by algorithm)
const SHRINE_LABELS: Record<number, string> = {
  1: "外围墙",
  2: "地板",
  3: "中心焦点区",
  4: "神坛祭台",
  5: "装饰位", // overridden per algorithm below
};

// Decoration label by algorithm
const SHRINE_DECO_LABEL: Record<string, string> = {
  clearing:  "营火",
  cruciform: "火把",
  arena:     "列柱",
};

// Values that should be output as "asset" type
const SHRINE_ASSET_VALS = new Set([4, 5]); // 神坛祭台 + 装饰位 = asset

function getShrineLabel(val: number, algorithm: string): string {
  if (val === 5) return SHRINE_DECO_LABEL[algorithm] ?? "装饰位";
  return SHRINE_LABELS[val] ?? `类型${val}`;
}

function isGrid(v: unknown): v is Grid {
  return Array.isArray(v) && Array.isArray((v as unknown[])[0]) &&
    typeof (v as Grid)[0]?.[0] === "number";
}

// Build the name list for the values actually present in the multi-value grid.
function buildNameList(multiGrid: Grid, algorithm: string): NameEntry[] {
  const valSet = new Set<number>();
  for (const row of multiGrid) for (const v of row) if (v !== 0) valSet.add(v);
  return [...valSet].sort((a, b) => a - b).map((val) => ({
    id: val,
    name: getShrineLabel(val, algorithm),
    type: SHRINE_ASSET_VALS.has(val) ? "asset" : "tile",
  }));
}

export function shrineLayout(input: Record<string, unknown>): Record<string, unknown> {
  const rawGrid     = input.inputGrid;
  const algorithm   = typeof input.algorithm  === "string" ? input.algorithm  : "clearing";
  const decorCount  = typeof input.decorCount === "number" ? Math.max(3, Math.min(12, Math.floor(input.decorCount))) : 8;
  const pathWidth   = typeof input.pathWidth  === "number" ? Math.max(1, Math.floor(input.pathWidth))               : 2;
  const rawSeed     = typeof input.seed       === "number" ? Math.floor(input.seed) : 0;

  if (!isGrid(rawGrid) || rawGrid.length === 0 || !rawGrid[0] || rawGrid[0].length === 0) {
    return { error: "inputGrid is required" };
  }
  const grid = rawGrid as Grid;

  const baseSeed = rawSeed !== 0 ? rawSeed : Math.floor(Math.random() * 2147483647) + 1;
  const rng = makeLCG(baseSeed);
  const dir = Math.floor(rng() * 4); // 0=north 1=east 2=south 3=west

  let multiGrid: Grid;
  switch (algorithm) {
    case "cruciform":
      multiGrid = generateCruciform(grid, pathWidth, dir);
      break;
    case "arena":
      multiGrid = generateArena(grid, decorCount, dir);
      break;
    default: // "clearing"
      multiGrid = generateClearing(grid, decorCount, dir);
  }

  return { outputGrid: multiGrid, outputNameList: buildNameList(multiGrid, algorithm) };
}
