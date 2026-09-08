/**
 * dock_pier_layout: 在单张区域掩码上生成一条从岸边伸进水里的栈桥 + 可选丁字头泊船平台 + 装饰点位（DataTree 形式）
 * 输入：inputGrid (grid/item) — 单张可用区域掩码网格; point (point2d) — 期望接岸位置;
 *       width/length/capSize (number) — 布局参数（capSize 是端头横条垂直于桥向的长度）
 * 输出：
 *   outputGrid (grid/item) — 单张多值网格（1=栈桥，2=端头泊船平台）；已是合并后的整条桥掩码，
 *                            下游直接喂一个 grid2node 建成单个节点，autotile 才能连通缝边
 *   decorGrid (grid/item) — 单格 0/1 网格，栈桥最外端的装饰点位（灯柱 / 系船桩），按物件而非 tile 摆放
 *   thickness (number/item) — 桥宽（= width），接 bridge_entry_tag.thickness，让端头判定不必猜桥宽
 * 网格列表由引擎按 DataTree 自动逐张 fanout。
 */

type Grid = number[][];

const PIER = 1; // pier deck
const CAP  = 2; // transverse T-head mooring platform at the far end
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

// Structures may extend beyond the mask (that is the point: a pier sticks out into the
// water, which is outside the region). Only the canvas clips them.
function setInCanvas(output: Grid, r: number, c: number, value: number): void {
  if (r < 0 || c < 0 || r >= output.length || c >= (output[0]?.length ?? 0)) return;
  output[r][c] = value;
}

// Point 先吸附到最近边界格，再由该处局部陆地分布推导四向外法线。
// 桥身从吸附点沿外法线长 length 格，只受画布边界约束——不再被有机岸线裁掉。
// grid[y][x]：r0=north/top，r1=south/bottom，c0=west/left，c1=east/right。
function generatePier(
  grid: Grid, point: Point, width: number, length: number, capSize: number,
): { deck: Grid; decor: Grid; tag: Grid } {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const deck: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const decor: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const tag: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  // Exactly `width` cells perpendicular to the growth axis (works for both odd and even
  // widths; even widths bias one extra cell to the right/bottom).
  const w = Math.max(1, width);
  const len = Math.max(1, length);
  const cap = Math.max(0, Math.floor(capSize));

  const anchor = nearestBoundary(boundaryCells(grid), point);
  if (!anchor) return { deck, decor, tag };
  const side = localOutwardSide(grid, anchor, Math.max(2, Math.ceil(Math.max(w, cap) / 2) + 2));

  const vertical = side === "south" || side === "north";
  const outwardIsNegative = side === "north" || side === "west";
  const step = outwardIsNegative ? -1 : 1;
  // Exactly n cells centered on the mid axis; even n biases one extra cell right/bottom.
  const centered = (mid: number, n: number): [number, number] => {
    const start = mid - Math.floor((n - 1) / 2);
    return [start, start + n - 1];
  };
  // `along` runs along the growth axis, `across` perpendicular to it.
  const put = (along: number, across: number, value: number) =>
    vertical ? setInCanvas(deck, along, across, value) : setInCanvas(deck, across, along, value);
  const putTag = (along: number, across: number, value: number) =>
    vertical ? setInCanvas(tag, along, across, value) : setInCanvas(tag, across, along, value);

  const mid = vertical ? anchor.c : anchor.r;
  const shore = vertical ? anchor.r : anchor.c;
  const band = centered(mid, w);
  const far = shore + step * (len - 1);

  // 固定压进岸内 4 格，避免有机岸线/海滩边缘与桥面之间露缝；Length 仍只表示向水面伸出的长度。
  for (let i = -INLAND_OVERLAP; i < len; i++) {
    for (let a = band[0]; a <= band[1]; a++) put(shore + i * step, a, PIER);
  }

  // 端头泊船平台是一条**垂直于桥向**的横条（丁字头），不是正方形：它把最外侧
  // min(w, len) 格加宽到 cap 格，总长仍是 len，不额外外伸。这个形状也正好让
  // autotile 自洽——横条两端各是一段长度 = 桥宽的终止长条，会被端头判定收口，
  // 横条中段与桥身连通，扶手照常沿边走。
  if (cap > w) {
    const capBand = centered(mid, cap);
    const depth = Math.min(w, len);
    for (let i = 0; i < depth; i++) {
      for (let a = capBand[0]; a <= capBand[1]; a++) put(far - i * step, a, CAP);
    }
  }

  // 开口沿垂直于桥向的长边：岸内端整条开口，外端若有丁字头则整条 cap 长边开口。
  // 丁字头两条短边不打标签，回落到 top 规则，保留栏杆。
  const entryTag = vertical ? 1 : 2;
  const inland = shore - step * INLAND_OVERLAP;
  for (let a = band[0]; a <= band[1]; a++) putTag(inland, a, entryTag);
  const outerBand = cap > w ? centered(mid, cap) : band;
  for (let a = outerBand[0]; a <= outerBand[1]; a++) putTag(far, a, entryTag);

  if (vertical) setInCanvas(decor, far, mid, 1);
  else setInCanvas(decor, mid, far, 1);

  return { deck, decor, tag };
}

function isGrid(v: unknown): v is Grid {
  return Array.isArray(v) && Array.isArray((v as unknown[])[0]) &&
    typeof (v as Grid)[0]?.[0] === "number";
}

export function dockPierLayout(input: Record<string, unknown>): Record<string, unknown> {
  const rawGrid = input.inputGrid;
  const point = parsePoint(input.point);
  const width = typeof input.width === "number" ? Math.max(1, Math.floor(input.width)) : 2;
  const length = typeof input.length === "number" ? Math.max(1, Math.floor(input.length)) : 6;
  const capSize = typeof input.capSize === "number" ? Math.max(0, Math.floor(input.capSize)) : 0;

  if (!isGrid(rawGrid) || rawGrid.length === 0 || !rawGrid[0] || rawGrid[0].length === 0) {
    return { error: "inputGrid is required" };
  }
  const grid = rawGrid as Grid;
  if (!point) return { error: "point is required and must be a point2d {x,y}" };

  const { deck, decor, tag } = generatePier(grid, point, width, length, capSize);

  return {
    outputGrid: deck,
    decorGrid: decor,
    tagGrid: tag,
    stateValues: STATE_VALUES,
    thickness: width,
  };
}
