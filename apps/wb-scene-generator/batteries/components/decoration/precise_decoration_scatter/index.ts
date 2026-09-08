/**
 * preciseDecorationScatter: 以指定坐标为中心，在单张网格目标区域内播撒一片自然装饰物
 * 若中心坐标不在目标区域内，BFS 就近吸附到最近目标格后再播撒
 *
 * DataTree 数据格式：输入 inputGrid 与输出 outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 *
 * 输入：inputGrid (grid) — 单张网格（目标值自动取最大值）;
 *       decorations (array) — [{decoration, count},...]; center (array) — [x, y];
 *       algorithm (string); scatterRadius (number); seed (number)
 * 输出：outputGrid (grid) — 单张多值网格（每种装饰物一个递增 id）; outputNameList (array); placedCount (number)
 */

type Grid = number[][];

interface DecorationRule {
  decoration: string;
  count: number;
}

interface NameEntry {
  id: number;
  name: string;
  type?: string;
}

// ── LCG 随机数生成器 ────────────────────────────────────────────
class LCG {
  private s: number;
  constructor(seed: number) {
    this.s = (seed === 0 ? Date.now() : seed) >>> 0;
    if (this.s === 0) this.s = 0x6d2b79f5;
  }
  next(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s / 0x100000000;
  }
  int(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }
}

// ── 类型判断 ────────────────────────────────────────────────────
function isGrid(v: unknown): v is Grid {
  if (!Array.isArray(v) || v.length === 0) return false;
  const first = (v as unknown[])[0];
  if (!Array.isArray(first) || (first as unknown[]).length === 0) return false;
  return typeof (first as unknown[])[0] === "number";
}

function isGridList(v: unknown): v is Grid[] {
  if (!Array.isArray(v) || v.length === 0) return false;
  const first = (v as unknown[])[0];
  if (!Array.isArray(first) || (first as unknown[]).length === 0) return false;
  return Array.isArray((first as unknown[])[0]);
}

function cloneGrid(grid: Grid): Grid {
  return grid.map(row => [...row]);
}

function gridMax(grid: Grid): number {
  let max = 0;
  for (const row of grid) for (const v of row) if (v > max) max = v;
  return max;
}

// ── 输入解析 ─────────────────────────────────────────────────────
function parseCenter(raw: unknown): [number, number] | null {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw); } catch { return null; }
  }
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const x = Number((arr as unknown[])[0]);
  const y = Number((arr as unknown[])[1]);
  if (isNaN(x) || isNaN(y)) return null;
  return [Math.round(x), Math.round(y)];
}

function parseDecorations(raw: unknown): DecorationRule[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];

  return (arr as unknown[]).flatMap((item: unknown) => {
    let r: Record<string, unknown>;
    if (typeof item === "string") {
      try { r = JSON.parse(item) as Record<string, unknown>; } catch { return []; }
    } else if (item && typeof item === "object") {
      r = item as Record<string, unknown>;
    } else {
      return [];
    }

    // 简化格式：{decoration名称: count数量}，单键对象
    if (typeof r.decoration !== "string" && typeof r.name !== "string") {
      const keys = Object.keys(r);
      for (const k of keys) {
        const v = r[k];
        if (typeof v === "number") {
          return [{ decoration: k.trim() || "decoration", count: Math.max(0, Math.round(v)) }];
        }
      }
      return [];
    }

    // 旧格式：{decoration, count} / {name, count}
    const decoration =
      typeof r.decoration === "string" ? r.decoration :
      typeof r.name === "string" ? r.name : "decoration";
    const count =
      typeof r.count === "number" ? Math.max(0, Math.round(r.count)) :
      typeof r.num === "number"   ? Math.max(0, Math.round(r.num)) : 1;
    return [{ decoration, count }];
  });
}

// ── BFS：将坐标吸附到最近的目标格 ────────────────────────────────
function bfsSnapToTarget(
  grid: Grid,
  cx: number,
  cy: number,
  targetValue: number
): [number, number] | null {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;

  const startX = Math.max(0, Math.min(cols - 1, cx));
  const startY = Math.max(0, Math.min(rows - 1, cy));

  if (grid[startY]?.[startX] === targetValue) return [startX, startY];

  const visited = new Set<string>();
  const queue: [number, number][] = [[startX, startY]];
  visited.add(`${startX},${startY}`);

  const dirs: [number, number][] = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1]
  ];

  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    if (grid[y]?.[x] === targetValue) return [x, y];
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push([nx, ny]);
    }
  }
  return null;
}

// ── 收集候选格 ──────────────────────────────────────────────────
function collectTargetCells(
  grid: Grid,
  cx: number,
  cy: number,
  targetValue: number,
  radius: number
): Array<[number, number]> {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const r2 = radius * radius;
  const cells: Array<[number, number]> = [];

  const minX = Math.max(0, cx - radius);
  const maxX = Math.min(cols - 1, cx + radius);
  const minY = Math.max(0, cy - radius);
  const maxY = Math.min(rows - 1, cy + radius);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (grid[y][x] !== targetValue) continue;
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) cells.push([x, y]);
    }
  }
  return cells;
}

// ── 工具：Fisher-Yates 洗牌 ──────────────────────────────────────
function shuffle<T>(arr: T[], rng: LCG): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── 噪声哈希（用于 noise 算法）──────────────────────────────────
function hashNoise(x: number, y: number, seed: number): number {
  let h = seed ^ (x * 374761393) ^ (y * 668265263);
  h = (Math.imul(h, 1540483477) + 0x6b43a9b5) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = (Math.imul(h, 0x85ebca77)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (Math.imul(h, 0xc2b2ae3d)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 0x100000000;
}

// ── 各播撒算法实现 ──────────────────────────────────────────────

/** random: 从候选格中均匀随机选取 count 个 */
function selectRandom(
  cells: Array<[number, number]>,
  count: number,
  rng: LCG
): Array<[number, number]> {
  return shuffle(cells, rng).slice(0, count);
}

/** cluster: 距中心越近权重越高，产生中心密边缘稀的簇状效果 */
function selectCluster(
  cells: Array<[number, number]>,
  cx: number,
  cy: number,
  count: number,
  rng: LCG
): Array<[number, number]> {
  const maxDist2 = cells.reduce((m, [x, y]) => {
    const d2 = (x - cx) ** 2 + (y - cy) ** 2;
    return d2 > m ? d2 : m;
  }, 1);

  // 加权水库采样：权重越大越优先被选
  const scored = cells.map(([x, y]) => {
    const d2 = (x - cx) ** 2 + (y - cy) ** 2;
    const weight = Math.pow(1 - d2 / (maxDist2 + 1), 2) + 0.05;
    return { x, y, key: Math.pow(rng.next(), 1 / weight) };
  });
  scored.sort((a, b) => b.key - a.key);
  return scored.slice(0, count).map(({ x, y }) => [x, y]);
}

/** ring: 优先在中半径环形区域放置，产生环状分布效果 */
function selectRing(
  cells: Array<[number, number]>,
  cx: number,
  cy: number,
  count: number,
  rng: LCG
): Array<[number, number]> {
  const distances = cells.map(([x, y]) =>
    Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
  );
  const maxDist = Math.max(...distances, 1);
  const ringRadius = maxDist * 0.55; // 环的中心在 55% 处

  const scored = cells.map(([x, y], i) => {
    const deviation = Math.abs(distances[i] - ringRadius) / maxDist;
    const weight = Math.pow(1 - deviation, 3) + 0.05;
    return { x, y, key: Math.pow(rng.next(), 1 / weight) };
  });
  scored.sort((a, b) => b.key - a.key);
  return scored.slice(0, count).map(({ x, y }) => [x, y]);
}

/** poisson: 泊松盘采样，使装饰物之间保持均匀间距 */
function selectPoisson(
  cells: Array<[number, number]>,
  count: number,
  rng: LCG
): Array<[number, number]> {
  // 根据 count 与候选格数量自动推算最小间距
  const minDist = Math.max(1.5, Math.sqrt(cells.length / (count + 1)) * 0.7);
  const minDist2 = minDist * minDist;
  const shuffled = shuffle(cells, rng);
  const placed: Array<[number, number]> = [];

  for (const [x, y] of shuffled) {
    if (placed.length >= count) break;
    const tooClose = placed.some(
      ([px, py]) => (x - px) ** 2 + (y - py) ** 2 < minDist2
    );
    if (!tooClose) placed.push([x, y]);
  }

  // 若泊松约束导致数量不足，放宽限制补足
  if (placed.length < count) {
    const usedSet = new Set(placed.map(([x, y]) => `${x},${y}`));
    for (const [x, y] of shuffled) {
      if (placed.length >= count) break;
      if (!usedSet.has(`${x},${y}`)) placed.push([x, y]);
    }
  }
  return placed;
}

/** noise: 基于空间噪声得分选取，产生自然斑块纹理感 */
function selectNoise(
  cells: Array<[number, number]>,
  cx: number,
  cy: number,
  count: number,
  seed: number
): Array<[number, number]> {
  const noiseSeed = seed === 0 ? 42 : seed;
  const scored = cells.map(([x, y]) => {
    const noise = hashNoise(x, y, noiseSeed);
    // 距中心越近、噪声值越高的格子越优先
    const distFactor = 1 / (1 + Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) * 0.08);
    return { x, y, score: noise * distFactor };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, count).map(({ x, y }) => [x, y]);
}

function selectCells(
  cells: Array<[number, number]>,
  cx: number,
  cy: number,
  count: number,
  algorithm: string,
  rng: LCG,
  seed: number
): Array<[number, number]> {
  if (cells.length === 0 || count <= 0) return [];
  const take = Math.min(count, cells.length);
  switch (algorithm) {
    case "cluster": return selectCluster(cells, cx, cy, take, rng);
    case "ring":    return selectRing(cells, cx, cy, take, rng);
    case "poisson": return selectPoisson(cells, take, rng);
    case "noise":   return selectNoise(cells, cx, cy, take, seed);
    default:        return selectRandom(cells, take, rng);
  }
}

// ── 单网格处理 ──────────────────────────────────────────────────
function processGrid(
  grid: Grid,
  center: [number, number],
  targetValue: number,
  decorations: DecorationRule[],
  algorithm: string,
  scatterRadius: number,
  seed: number
): { outputGrid: Grid; nameList: NameEntry[]; placedCount: number } {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  // 输出网格全零，只写入装饰物格点
  const out: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  if (rows === 0 || cols === 0) {
    return { outputGrid: out, nameList: [], placedCount: 0 };
  }

  const snapped = bfsSnapToTarget(grid, center[0], center[1], targetValue);
  if (!snapped) {
    return { outputGrid: out, nameList: [], placedCount: 0 };
  }
  const [cx, cy] = snapped;

  const baseId = gridMax(grid) + 1;
  let currentId = baseId;
  const nameList: NameEntry[] = [];
  let totalPlaced = 0;

  // 候选格：目标值且在播撒半径内
  let freeCells = collectTargetCells(grid, cx, cy, targetValue, scatterRadius);
  const rng = new LCG(seed);

  for (const dec of decorations) {
    const decId = currentId++;
    nameList.push({ id: decId, name: dec.decoration, type: "asset" });

    if (freeCells.length === 0 || dec.count <= 0) continue;

    const selected = selectCells(freeCells, cx, cy, dec.count, algorithm, rng, seed);
    const usedKeys = new Set(selected.map(([x, y]) => `${x},${y}`));

    for (const [x, y] of selected) {
      out[y][x] = decId;
      totalPlaced++;
    }

    // 后续装饰物只能放在尚未占用的格子
    freeCells = freeCells.filter(([x, y]) => !usedKeys.has(`${x},${y}`));
  }

  return { outputGrid: out, nameList, placedCount: totalPlaced };
}

// ── 主导出函数 ──────────────────────────────────────────────────
export function preciseDecorationScatter(
  input: Record<string, unknown>
): Record<string, unknown> {
  const rawGrid = input.inputGrid;
  if (!isGrid(rawGrid)) return { error: "inputGrid is required (number[][])" };
  const grid = rawGrid as Grid;

  const center = parseCenter(input.center);

  const decorations = parseDecorations(input.decorations);
  if (decorations.length === 0) {
    return { error: "decorations must be a non-empty array of {decoration, count}" };
  }

  const algorithm = typeof input.algorithm === "string" ? input.algorithm : "random";
  const scatterRadius =
    typeof input.scatterRadius === "number"
      ? Math.max(1, Math.round(input.scatterRadius))
      : 12;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;

  const tv = gridMax(grid);

  // center 未提供时，从目标区域（非零格）中随机选一个点
  let effectiveCenter: [number, number];
  if (center) {
    effectiveCenter = center;
  } else {
    const nonZero: [number, number][] = [];
    for (let r = 0; r < grid.length; r++) {
      for (let c = 0; c < (grid[0]?.length ?? 0); c++) {
        if (grid[r][c] !== 0) nonZero.push([c, r]);
      }
    }
    if (nonZero.length === 0) {
      const empty: Grid = grid.map(row => row.map(() => 0));
      return { outputGrid: empty, outputNameList: [], placedCount: 0 };
    }
    const rng = new LCG(baseSeed);
    effectiveCenter = nonZero[Math.floor(rng.next() * nonZero.length)];
  }

  // 单张多值网格：每种装饰物一个递增 id
  const { outputGrid, nameList, placedCount } = processGrid(
    grid, effectiveCenter, tv, decorations, algorithm, scatterRadius, baseSeed
  );

  // 仅保留实际写入网格的装饰物条目
  const present = new Set<number>();
  for (const row of outputGrid) for (const v of row) if (v !== 0) present.add(v);
  const outputNameList: NameEntry[] = nameList.filter(e => present.has(e.id));

  return { outputGrid, outputNameList, placedCount };
}
