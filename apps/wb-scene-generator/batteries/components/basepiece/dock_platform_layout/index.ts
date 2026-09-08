/**
 * dock_platform_layout: 在单张区域掩码上生成码头平台（引桥从岸边伸进水里 + 尽头一块大甲板）
 * 输入：inputGrid (grid/item) — 单张可用区域掩码网格; point (point2d) — 期望接岸位置;
 *       width/length (number) — 引桥尺寸; deckWidth/deckDepth (number) — 尽头甲板尺寸
 * 输出：
 *   outputGrid (grid/item) — 单张多值网格（1=甲板，2=引桥）；已是合并后的整片掩码，
 *                            下游直接喂一个 grid2node 建成单个节点，autotile 才能连通缝边
 *   thickness (number/item) — 引桥宽（= width），接 bridge_entry_tag.thickness，让端头判定不必猜桥宽
 * 网格列表由引擎按 DataTree 自动逐张 fanout。
 */

type Grid = number[][];

const DECK = 1; // 尽头大甲板，泊船的那一块
const APPROACH = 2; // 引桥，从岸边伸到甲板
const INLAND_OVERLAP = 4;
const STATE_VALUES = ['', 'entry_h', 'entry_v'];

type Side = "north" | "south" | "east" | "west";
type Cell = { r: number; c: number };
type Point = { x: number; y: number };

const DIRECTIONS: ReadonlyArray<{ side: Side; dr: number; dc: number }> = [
  { side: "north", dr: -1, dc: 0 },
  { side: "south", dr: 1, dc: 0 },
  { side: "west", dr: 0, dc: -1 },
  { side: "east", dr: 0, dc: 1 },
];

function parsePoint(raw: unknown): Point | null {
  const value = raw as { x?: unknown; y?: unknown } | [unknown, unknown] | null | undefined;
  const x = Number(Array.isArray(value) ? value[0] : value?.x);
  const y = Number(Array.isArray(value) ? value[1] : value?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function isLand(grid: Grid, r: number, c: number): boolean {
  return r >= 0 && c >= 0 && r < grid.length && c < (grid[0]?.length ?? 0) &&
    (grid[r]?.[c] ?? 0) !== 0;
}

/** 4 邻域至少有一格水/画布外的陆地格，视为可接岸的边界格。 */
function boundaryCells(grid: Grid): Cell[] {
  const cells: Cell[] = [];
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[0]?.length ?? 0); c++) {
      if (!isLand(grid, r, c)) continue;
      if (DIRECTIONS.some(({ dr, dc }) => !isLand(grid, r + dr, c + dc))) cells.push({ r, c });
    }
  }
  return cells;
}

/** Point 不在岸线上时，按欧氏距离吸附到最近边界格；并列按 row-major 稳定取值。 */
function nearestBoundary(cells: Cell[], point: Point): Cell | null {
  let best: Cell | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cell of cells) {
    const distance = (cell.c - point.x) ** 2 + (cell.r - point.y) ** 2;
    if (distance < bestDistance) {
      best = cell;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * 用接岸点附近的陆地分布估算局部四向外法线。
 * 只考虑紧邻接岸点就是水/画布外的方向；陆地主要落在该方向反侧时得分更高。
 */
function localOutwardSide(grid: Grid, anchor: Cell, radius: number): Side {
  let best = DIRECTIONS[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const direction of DIRECTIONS) {
    if (isLand(grid, anchor.r + direction.dr, anchor.c + direction.dc)) continue;

    let score = 0;
    for (let r = Math.max(0, anchor.r - radius); r <= Math.min(grid.length - 1, anchor.r + radius); r++) {
      for (let c = Math.max(0, anchor.c - radius); c <= Math.min((grid[0]?.length ?? 1) - 1, anchor.c + radius); c++) {
        if (!isLand(grid, r, c)) continue;
        const rr = anchor.r - r;
        const cc = anchor.c - c;
        const projection = rr * direction.dr + cc * direction.dc;
        const distance = Math.max(1, Math.hypot(rr, cc));
        score += projection / distance;
      }
    }

    if (score > bestScore) {
      best = direction;
      bestScore = score;
    }
  }
  return best.side;
}

// Structures may extend beyond the mask (that is the point: a dock sticks out into the
// water, which is outside the region). Only the canvas clips them.
function setInCanvas(output: Grid, r: number, c: number, value: number): void {
  if (r < 0 || c < 0 || r >= output.length || c >= (output[0]?.length ?? 0)) return;
  output[r][c] = value;
}

// Point 先吸附到最近边界格，再由该处局部陆地分布推导四向外法线。
// 引桥从吸附点沿外法线长 length 格，再往外接一块 deckWidth × deckDepth 的大甲板；
// 两段只受画布边界约束，不再被有机岸线裁掉。
// grid[y][x]：r0=north/top，r1=south/bottom，c0=west/left，c1=east/right。
function generatePlatform(
  grid: Grid, point: Point, deckWidth: number, deckDepth: number, width: number, length: number,
): { output: Grid; tag: Grid } {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const tag: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  const dw = Math.max(1, deckWidth);
  const dd = Math.max(1, deckDepth);
  const w = Math.max(1, width);
  const len = Math.max(0, length);

  const anchor = nearestBoundary(boundaryCells(grid), point);
  if (!anchor) return { output, tag };
  const side = localOutwardSide(grid, anchor, Math.max(2, Math.ceil(Math.max(dw, w) / 2) + 2));
  const vertical = side === "south" || side === "north";
  // Exactly N cells centered on the mid axis; even N biases one extra cell right/bottom.
  const centered = (mid: number, n: number): [number, number] => {
    const start = mid - Math.floor((n - 1) / 2);
    return [start, start + n - 1];
  };

  if (vertical) {
    const outwardIsNegative = side === "north";
    const walkBand = centered(anchor.c, w);
    const step = outwardIsNegative ? -1 : 1;
    const deckBand = centered(anchor.c, dw);
    // 固定压进岸内 4 格；Length 仍只表示从岸线向水面伸出的长度。
    for (let i = -INLAND_OVERLAP; i < len; i++) {
      const r = anchor.r + i * step;
      for (let c = walkBand[0]; c <= walkBand[1]; c++) setInCanvas(output, r, c, APPROACH);
    }
    for (let i = 0; i < dd; i++) {
      const r = anchor.r + (len + i) * step;
      for (let c = deckBand[0]; c <= deckBand[1]; c++) setInCanvas(output, r, c, DECK);
    }
    // 岸内端和甲板外侧长边开口；甲板两条短边不打标签，保留栏杆。
    const inland = anchor.r - step * INLAND_OVERLAP;
    for (let c = walkBand[0]; c <= walkBand[1]; c++) setInCanvas(tag, inland, c, 1);
    const outer = anchor.r + (len + dd - 1) * step;
    for (let c = deckBand[0]; c <= deckBand[1]; c++) setInCanvas(tag, outer, c, 1);
  } else {
    const outwardIsNegative = side === "west";
    const walkBand = centered(anchor.r, w);
    const step = outwardIsNegative ? -1 : 1;
    const deckBand = centered(anchor.r, dw);
    for (let i = -INLAND_OVERLAP; i < len; i++) {
      const c = anchor.c + i * step;
      for (let r = walkBand[0]; r <= walkBand[1]; r++) setInCanvas(output, r, c, APPROACH);
    }
    for (let i = 0; i < dd; i++) {
      const c = anchor.c + (len + i) * step;
      for (let r = deckBand[0]; r <= deckBand[1]; r++) setInCanvas(output, r, c, DECK);
    }
    const inland = anchor.c - step * INLAND_OVERLAP;
    for (let r = walkBand[0]; r <= walkBand[1]; r++) setInCanvas(tag, r, inland, 2);
    const outer = anchor.c + (len + dd - 1) * step;
    for (let r = deckBand[0]; r <= deckBand[1]; r++) setInCanvas(tag, r, outer, 2);
  }

  return { output, tag };
}

function isGrid(v: unknown): v is Grid {
  return Array.isArray(v) && Array.isArray((v as unknown[])[0]) &&
    typeof (v as Grid)[0]?.[0] === "number";
}

function intParam(raw: unknown, fallback: number, min: number): number {
  return typeof raw === "number" ? Math.max(min, Math.floor(raw)) : fallback;
}

export function dockPlatformLayout(input: Record<string, unknown>): Record<string, unknown> {
  const rawGrid = input.inputGrid;
  const point = parsePoint(input.point);
  const deckWidth = intParam(input.deckWidth, 9, 1);
  const deckDepth = intParam(input.deckDepth, 5, 1);
  const width = intParam(input.width, 3, 1);
  const length = intParam(input.length, 6, 0);

  if (!isGrid(rawGrid) || rawGrid.length === 0 || !rawGrid[0] || rawGrid[0].length === 0) {
    return { error: "inputGrid is required" };
  }
  const grid = rawGrid as Grid;
  if (!point) return { error: "point is required and must be a point2d {x,y}" };

  const { output: outputGrid, tag: tagGrid } =
    generatePlatform(grid, point, deckWidth, deckDepth, width, length);

  return { outputGrid, tagGrid, stateValues: STATE_VALUES, thickness: width };
}
