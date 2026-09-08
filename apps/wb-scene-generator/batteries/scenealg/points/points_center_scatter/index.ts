/**
 * pointsCenterScatter: 以兴趣点为中心，在父 region 有效格内按半径与算法采样装饰点位。
 *
 * 核心算法来自 components/decoration/precise_decoration_scatter：
 *   · BFS 将 center/point 吸附到最近有效格
 *   · 圆形 scatterRadius 内收集候选格
 *   · random / cluster / ring / poisson / noise 选点
 *
 * 输入：region (grid) — 父区域掩码
 *       point (point2d) — 兴趣点，x→列、y→行（可选；缺省从有效格随机选）
 *       count (number) — 采样数量
 *       scatterRadius (number) — 播撒半径（格）
 *       algorithm (string) — 采样算法
 *       targetValue (number) — 0=任意非零格；非 0 精确匹配
 *       seed (number)
 * 输出：points (grid list) — 每个选中格一张单点 0/1 网格（与 field2points 契约一致）
 *       count (number) — 实际采样数
 *       snappedCenter (array) — 吸附后的 [x, y]
 */

type Grid = number[][];

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

function parseCenter(raw: unknown): [number, number] | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const p = raw as { x?: unknown; y?: unknown };
    const x = Number(p.x);
    const y = Number(p.y);
    if (Number.isFinite(x) && Number.isFinite(y)) return [Math.round(x), Math.round(y)];
  }
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr) || arr.length < 2) return null;
  const x = Number(arr[0]);
  const y = Number(arr[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [Math.round(x), Math.round(y)];
}

function isValidCell(region: Grid, r: number, c: number, targetValue: number): boolean {
  const v = region[r]?.[c] ?? 0;
  return targetValue === 0 ? v !== 0 : v === targetValue;
}

function bfsSnapToTarget(
  region: Grid,
  cx: number,
  cy: number,
  targetValue: number
): [number, number] | null {
  const rows = region.length;
  const cols = region[0]?.length ?? 0;
  const startX = Math.max(0, Math.min(cols - 1, cx));
  const startY = Math.max(0, Math.min(rows - 1, cy));

  if (isValidCell(region, startY, startX, targetValue)) return [startX, startY];

  const visited = new Set<string>();
  const queue: [number, number][] = [[startX, startY]];
  visited.add(`${startX},${startY}`);

  const dirs: [number, number][] = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1],
  ];

  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    if (isValidCell(region, y, x, targetValue)) return [x, y];
    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push([nx, ny]);
    }
  }
  return null;
}

function collectTargetCells(
  region: Grid,
  cx: number,
  cy: number,
  targetValue: number,
  radius: number
): Array<[number, number]> {
  const rows = region.length;
  const cols = region[0]?.length ?? 0;
  const r2 = radius * radius;
  const cells: Array<[number, number]> = [];

  const minX = Math.max(0, cx - radius);
  const maxX = Math.min(cols - 1, cx + radius);
  const minY = Math.max(0, cy - radius);
  const maxY = Math.min(rows - 1, cy + radius);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (!isValidCell(region, y, x, targetValue)) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) cells.push([x, y]);
    }
  }
  return cells;
}

function shuffle<T>(arr: T[], rng: LCG): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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

function selectRandom(cells: Array<[number, number]>, count: number, rng: LCG): Array<[number, number]> {
  return shuffle(cells, rng).slice(0, count);
}

function selectCluster(
  cells: Array<[number, number]>,
  cx: number,
  cy: number,
  count: number,
  rng: LCG
): Array<[number, number]> {
  const maxDist2 = cells.reduce((m, [x, y]) => Math.max(m, (x - cx) ** 2 + (y - cy) ** 2), 1);
  const scored = cells.map(([x, y]) => {
    const d2 = (x - cx) ** 2 + (y - cy) ** 2;
    const weight = Math.pow(1 - d2 / (maxDist2 + 1), 2) + 0.05;
    return { x, y, key: Math.pow(rng.next(), 1 / weight) };
  });
  scored.sort((a, b) => b.key - a.key);
  return scored.slice(0, count).map(({ x, y }) => [x, y]);
}

function selectRing(
  cells: Array<[number, number]>,
  cx: number,
  cy: number,
  count: number,
  rng: LCG
): Array<[number, number]> {
  const distances = cells.map(([x, y]) => Math.hypot(x - cx, y - cy));
  const maxDist = Math.max(...distances, 1);
  const ringRadius = maxDist * 0.55;
  const scored = cells.map(([x, y], i) => {
    const deviation = Math.abs(distances[i] - ringRadius) / maxDist;
    const weight = Math.pow(1 - deviation, 3) + 0.05;
    return { x, y, key: Math.pow(rng.next(), 1 / weight) };
  });
  scored.sort((a, b) => b.key - a.key);
  return scored.slice(0, count).map(({ x, y }) => [x, y]);
}

function selectPoisson(cells: Array<[number, number]>, count: number, rng: LCG): Array<[number, number]> {
  const minDist = Math.max(1.5, Math.sqrt(cells.length / (count + 1)) * 0.7);
  const minDist2 = minDist * minDist;
  const shuffled = shuffle(cells, rng);
  const placed: Array<[number, number]> = [];

  for (const [x, y] of shuffled) {
    if (placed.length >= count) break;
    const tooClose = placed.some(([px, py]) => (x - px) ** 2 + (y - py) ** 2 < minDist2);
    if (!tooClose) placed.push([x, y]);
  }
  if (placed.length < count) {
    const used = new Set(placed.map(([x, y]) => `${x},${y}`));
    for (const [x, y] of shuffled) {
      if (placed.length >= count) break;
      if (!used.has(`${x},${y}`)) placed.push([x, y]);
    }
  }
  return placed;
}

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
    const distFactor = 1 / (1 + Math.hypot(x - cx, y - cy) * 0.08);
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
    case "cluster":
      return selectCluster(cells, cx, cy, take, rng);
    case "ring":
      return selectRing(cells, cx, cy, take, rng);
    case "poisson":
      return selectPoisson(cells, take, rng);
    case "noise":
      return selectNoise(cells, cx, cy, take, seed);
    default:
      return selectRandom(cells, take, rng);
  }
}

function toPointList(region: Grid, selected: Array<[number, number]>): Grid[] {
  const rows = region.length;
  const cols = region[0]?.length ?? 0;
  return selected.map(([x, y]) => {
    const g: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
    g[y][x] = 1;
    return g;
  });
}

export function pointsCenterScatter(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: "region is required" };
  }

  const rows = region.length;
  const cols = region[0].length;
  const targetValue = typeof input.targetValue === "number" ? Math.round(input.targetValue) : 0;
  const wantCount = typeof input.count === "number" ? Math.max(0, Math.round(input.count)) : 5;
  const algorithm = typeof input.algorithm === "string" ? input.algorithm : "random";
  const scatterRadius =
    typeof input.scatterRadius === "number" ? Math.max(1, Math.round(input.scatterRadius)) : 12;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;

  const parsed = parseCenter(input.point ?? input.center);
  let effectiveCenter: [number, number] | null = parsed;

  if (!effectiveCenter) {
    const candidates: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (isValidCell(region, r, c, targetValue)) candidates.push([c, r]);
      }
    }
    if (candidates.length === 0) {
      return { points: [], count: 0, snappedCenter: [0, 0] };
    }
    const rng = new LCG(baseSeed);
    effectiveCenter = candidates[rng.int(0, candidates.length - 1)];
  }

  const snapped = bfsSnapToTarget(region, effectiveCenter[0], effectiveCenter[1], targetValue);
  if (!snapped) {
    return { points: [], count: 0, snappedCenter: effectiveCenter };
  }

  const [cx, cy] = snapped;
  const freeCells = collectTargetCells(region, cx, cy, targetValue, scatterRadius);
  const rng = new LCG(baseSeed);
  const selected = selectCells(freeCells, cx, cy, wantCount, algorithm, rng, baseSeed);
  const points = toPointList(region, selected);

  return {
    points,
    count: selected.length,
    snappedCenter: [cx, cy],
  };
}
