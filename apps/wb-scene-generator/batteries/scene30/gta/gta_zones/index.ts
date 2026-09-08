type Grid = number[][];

interface NameEntry {
  id: number;
  name: string;
  type?: string;
}

interface Point { x: number; y: number; }
interface Cell extends Point { idx: number; }
interface Bounds { minX: number; minY: number; maxX: number; maxY: number; has: boolean; }
interface Component { cells: Cell[]; bounds: Bounds; area: number; }
interface ZoneSeed extends Point { zone: number; weight: number; kind: "cbd" | "residential" | "industrial" | "suburb"; }
interface HeapNode { idx: number; priority: number; zone: number; seedX: number; seedY: number; }

// ── 分区 ID ──────────────────────────────────────────────────────────────
const BEACH = 420;        // 沙滩
const COMMERCIAL = 421;   // 商业核心区（平原中心）
const RESIDENTIAL = 422;  // 住宅区（平原环带）
const INDUSTRIAL = 423;   // 工业港区（平原沿海）
const PARK = 424;         // 中央公园（平原内挖空）
const GREENING = 425;     // 山地绿化（丘陵）
const MOUNTAIN = 426;     // 自然山地
const SUBURB = 427;       // 乡郊区域（平原外围低密度）

// 城市开发区集合（参与平滑/碎片合并/可建设掩码）
const URBAN_ZONES = [COMMERCIAL, RESIDENTIAL, INDUSTRIAL, PARK, SUBURB];

const DIR4 = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
const DIR8: Array<[number, number, number]> = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2],
];

const NAMES: NameEntry[] = [
  { id: BEACH, name: "沙滩", type: "tile" },
  { id: COMMERCIAL, name: "商业核心区", type: "tile" },
  { id: RESIDENTIAL, name: "住宅区", type: "tile" },
  { id: INDUSTRIAL, name: "工业港区", type: "tile" },
  { id: PARK, name: "中央公园", type: "tile" },
  { id: GREENING, name: "山地绿化", type: "tile" },
  { id: MOUNTAIN, name: "山地", type: "tile" },
  { id: SUBURB, name: "乡郊区域", type: "tile" },
];

function isGrid(value: unknown): value is Grid {
  return Array.isArray(value)
    && value.length > 0
    && Array.isArray(value[0])
    && ((value[0] as unknown[]).length === 0 || typeof (value[0] as unknown[])[0] === "number");
}

function makeGrid(rows: number, cols: number, fill = 0): Grid {
  return Array.from({ length: rows }, () => new Array(cols).fill(fill));
}

function num(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function int(input: Record<string, unknown>, key: string, fallback: number): number {
  return Math.round(num(input, key, fallback));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveSeed(seed: unknown): number {
  const raw = typeof seed === "number" && Number.isFinite(seed) ? seed : 0;
  return raw === 0 ? 123456789 : raw >>> 0;
}

function hash2(x: number, y: number, seed: number): number {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = x - x0;
  const yf = y - y0;
  const v00 = hash2(x0, y0, seed);
  const v10 = hash2(x0 + 1, y0, seed);
  const v01 = hash2(x0, y0 + 1, seed);
  const v11 = hash2(x0 + 1, y0 + 1, seed);
  const u = fade(xf);
  const v = fade(yf);
  return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
}

class MinHeap {
  private data: HeapNode[] = [];
  get length(): number { return this.data.length; }

  push(item: HeapNode): void {
    this.data.push(item);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): HeapNode | undefined {
    const first = this.data[0];
    const last = this.data.pop();
    if (!last || this.data.length === 0) return first;
    this.data[0] = last;
    this.bubbleDown(0);
    return first;
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.data[parent].priority <= this.data[index].priority) break;
      [this.data[parent], this.data[index]] = [this.data[index], this.data[parent]];
      index = parent;
    }
  }

  private bubbleDown(index: number): void {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < this.data.length && this.data[left].priority < this.data[best].priority) best = left;
      if (right < this.data.length && this.data[right].priority < this.data[best].priority) best = right;
      if (best === index) break;
      [this.data[best], this.data[index]] = [this.data[index], this.data[best]];
      index = best;
    }
  }
}

// ── 地形分类 ──────────────────────────────────────────────────────────────
// 优先用显式地形掩码；缺失时按 gta_heightmap 阈值从 heightMap 派生；
// 都没有时整块陆地视为平原。返回每个陆地像素的类别：
//   0=平原, 1=沙滩, 2=丘陵, 3=山地
function classifyTerrain(
  input: Record<string, unknown>,
  land: Grid, rows: number, cols: number,
  heightMap: Grid | null,
): Grid {
  const beach    = isGrid(input.beachGrid)    ? input.beachGrid as Grid    : null;
  const plains   = isGrid(input.plainsGrid)   ? input.plainsGrid as Grid   : null;
  const hills    = isGrid(input.hillsGrid)    ? input.hillsGrid as Grid    : null;
  const mountain = isGrid(input.mountainGrid) ? input.mountainGrid as Grid : null;
  const hasMasks = !!(beach || plains || hills || mountain);

  const cat = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!land[y]?.[x]) continue;
      if (hasMasks) {
        // 显式掩码优先级：山地 > 丘陵 > 沙滩 > 平原（默认）
        if (mountain?.[y]?.[x]) cat[y][x] = 3;
        else if (hills?.[y]?.[x]) cat[y][x] = 2;
        else if (beach?.[y]?.[x]) cat[y][x] = 1;
        else cat[y][x] = 0;
      } else if (heightMap) {
        const h = heightMap[y]?.[x] ?? 0.55;
        if (h >= 0.88) cat[y][x] = 3;
        else if (h >= 0.76) cat[y][x] = 2;
        else if (h < 0.47) cat[y][x] = 1;
        else cat[y][x] = 0;
      } else {
        cat[y][x] = 0;  // 全部视为平原
      }
    }
  }
  return cat;
}

function boundsOfCells(cells: Cell[], cols: number, rows: number): Bounds {
  const b: Bounds = { minX: cols, minY: rows, maxX: 0, maxY: 0, has: cells.length > 0 };
  for (const c of cells) {
    b.minX = Math.min(b.minX, c.x);
    b.minY = Math.min(b.minY, c.y);
    b.maxX = Math.max(b.maxX, c.x);
    b.maxY = Math.max(b.maxY, c.y);
  }
  return b;
}

function maskComponents(mask: Grid, minArea = 1): Component[] {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const seen = new Uint8Array(rows * cols);
  const comps: Component[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const start = y * cols + x;
      if (!mask[y]?.[x] || seen[start]) continue;
      const queue = [start];
      const cells: Cell[] = [];
      seen[start] = 1;
      for (let head = 0; head < queue.length; head++) {
        const idx = queue[head];
        const cx = idx % cols;
        const cy = Math.floor(idx / cols);
        cells.push({ x: cx, y: cy, idx });
        for (const [dx, dy] of DIR4) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (seen[ni] || !mask[ny]?.[nx]) continue;
          seen[ni] = 1;
          queue.push(ni);
        }
      }
      if (cells.length >= minArea) comps.push({ cells, bounds: boundsOfCells(cells, cols, rows), area: cells.length });
    }
  }
  return comps.sort((a, b) => b.area - a.area);
}

// 距海岸距离：以整块陆地为输入，边缘（贴海/出界）为 0，向内递增。
function distanceFromZero(mask: Grid): Grid {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const dist = makeGrid(rows, cols, 0).map(row => row.map(() => Infinity));
  const queue: number[] = [];
  let head = 0;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && mask[y][x] > 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y][x]) continue;
      let edge = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
      for (const [dx, dy] of DIR4) {
        if (!inside(x + dx, y + dy)) edge = true;
      }
      if (edge) {
        dist[y][x] = 0;
        queue.push(y * cols + x);
      }
    }
  }
  while (head < queue.length) {
    const idx = queue[head++];
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    for (const [dx, dy] of DIR4) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(nx, ny) || dist[ny][nx] <= dist[y][x] + 1) continue;
      dist[ny][nx] = dist[y][x] + 1;
      queue.push(ny * cols + nx);
    }
  }
  return dist;
}

function slopeMap(mask: Grid, heightMap: Grid | null): Grid {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const out = makeGrid(rows, cols, 0);
  if (!heightMap) return out;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y]?.[x]) continue;
      const h = heightMap[y]?.[x] ?? 0.55;
      let maxSlope = 0;
      for (const [dx, dy] of DIR8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !mask[ny]?.[nx]) continue;
        maxSlope = Math.max(maxSlope, Math.abs(h - (heightMap[ny]?.[nx] ?? h)));
      }
      out[y][x] = maxSlope;
    }
  }
  return out;
}

// 平原片区中心：偏向沿海、低坡的几何中心。
function componentCenter(cells: Cell[], coastDist: Grid, slope: Grid): Point {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (const c of cells) {
    const s = slope[c.y]?.[c.x] ?? 0;
    const coast = Math.min(52, coastDist[c.y]?.[c.x] ?? 0);
    const w = (1 + coast) * clamp(1.25 - s * 3, 0.22, 1.25);
    sx += c.x * w;
    sy += c.y * w;
    sw += w;
  }
  return sw > 0 ? { x: sx / sw, y: sy / sw } : { x: 0, y: 0 };
}

function bestCell(cells: Cell[], score: (cell: Cell) => number): Cell | null {
  let best: Cell | null = null;
  let bestScore = -Infinity;
  for (const cell of cells) {
    const s = score(cell);
    if (s > bestScore) {
      bestScore = s;
      best = cell;
    }
  }
  return best;
}

function farthestCells(cells: Cell[], count: number, score: (cell: Cell) => number, seed: number, minDistance: number, existing: Point[] = []): Cell[] {
  const picked: Cell[] = [];
  const anchors: Point[] = [...existing];
  for (let i = 0; i < count; i++) {
    const p = bestCell(cells, cell => {
      let nearest = Infinity;
      for (const a of anchors) nearest = Math.min(nearest, Math.hypot(cell.x - a.x, cell.y - a.y));
      const spacing = clamp(nearest / Math.max(1, minDistance), 0, 1.8);
      return score(cell) * (0.65 + spacing) + hash2(cell.x, cell.y, seed + i * 997) * 0.08;
    });
    if (!p) break;
    picked.push(p);
    anchors.push(p);
  }
  return picked;
}

// ── 平原内布种：商业核心(中心) + 工业港(沿海) + 住宅(环带) ─────────────────
function buildSeeds(
  comp: Component,
  coastDist: Grid,
  slope: Grid,
  center: Point,
  coastInset: number,
  seed: number,
): ZoneSeed[] {
  const diag = Math.max(1, Math.hypot(comp.bounds.maxX - comp.bounds.minX + 1, comp.bounds.maxY - comp.bounds.minY + 1));
  const cellScore = (cell: Cell) => {
    const s = slope[cell.y]?.[cell.x] ?? 0;
    const coast = coastDist[cell.y]?.[cell.x] ?? 0;
    const dCenter = Math.hypot(cell.x - center.x, cell.y - center.y) / diag;
    return { s, coast, dCenter, flat: clamp(1 - s / 0.16, 0, 1) };
  };

  const anchors: ZoneSeed[] = [];

  // 商业核心：随机 1~2 个，居中、平坦、略离海岸
  const cbdCount = 1 + Math.floor(hash2(comp.bounds.minX, comp.bounds.minY, seed + 71) * 2); // 1 或 2
  const cbds = farthestCells(
    comp.cells,
    cbdCount,
    cell => {
      const m = cellScore(cell);
      const inset = clamp((m.coast - coastInset) / 18, 0, 1);
      return (1 - m.dCenter) * 1.3 + m.flat * 0.7 + inset * 0.4;
    },
    seed + 73,
    Math.max(18, diag * 0.22),
  );
  for (const p of cbds) anchors.push({ x: p.x, y: p.y, zone: COMMERCIAL, weight: 1, kind: "cbd" });
  const cbd = cbds[0] ?? null;

  // 工业港：紧贴海岸、远离 CBD
  const industrial = bestCell(comp.cells, cell => {
    const m = cellScore(cell);
    const fromCbd = cbd ? Math.hypot(cell.x - cbd.x, cell.y - cbd.y) / diag : m.dCenter;
    const coastBand = 1 - clamp(Math.abs(m.coast - Math.max(2, coastInset * 0.5)) / 16, 0, 1);
    return coastBand * 1.35 + fromCbd * 0.65 + m.flat * 0.35;
  });
  if (industrial && (!cbd || Math.hypot(industrial.x - cbd.x, industrial.y - cbd.y) > diag * 0.16)) {
    anchors.push({ x: industrial.x, y: industrial.y, zone: INDUSTRIAL, weight: 1, kind: "industrial" });
  }

  // 住宅：围绕 CBD 的中环（略微缩小：种子更少、间距更大）
  const resCount = clamp(Math.round(Math.sqrt(comp.area) / 80) + 1, 1, 6);
  const res = farthestCells(
    comp.cells,
    resCount,
    cell => {
      const m = cellScore(cell);
      const ring = 1 - clamp(Math.abs(m.dCenter - 0.4) / 0.4, 0, 1);
      return ring * 0.95 + m.flat * 0.7;
    },
    seed + 211,
    Math.max(20, diag * 0.2),
    anchors,
  );
  for (const p of res) anchors.push({ x: p.x, y: p.y, zone: RESIDENTIAL, weight: 1, kind: "residential" });

  // 乡郊：平原外围低密度，远离中心
  const suburbCount = clamp(Math.round(Math.sqrt(comp.area) / 110) + 1, 1, 5);
  const suburbs = farthestCells(
    comp.cells,
    suburbCount,
    cell => {
      const m = cellScore(cell);
      return m.dCenter * 1.2 + m.flat * 0.4 + valueNoise(cell.x * 0.02, cell.y * 0.02, seed + 503) * 0.25;
    },
    seed + 509,
    Math.max(24, diag * 0.22),
    anchors,
  );
  for (const p of suburbs) anchors.push({ x: p.x, y: p.y, zone: SUBURB, weight: 1, kind: "suburb" });

  return anchors;
}

function zoneStepCost(zone: number, x: number, y: number, px: number, py: number, seedX: number, seedY: number, coastDist: Grid, slope: Grid, heightMap: Grid | null, center: Point, diag: number, coastInset: number, seed: number): number {
  const h = heightMap ? (heightMap[y]?.[x] ?? 0.55) : 0.55;
  const ph = heightMap ? (heightMap[py]?.[px] ?? h) : h;
  const s = slope[y]?.[x] ?? 0;
  const coast = coastDist[y]?.[x] ?? 0;
  const dCenter = Math.hypot(x - center.x, y - center.y) / diag;
  const dSeed = Math.hypot(x - seedX, y - seedY) / diag;
  const noise = valueNoise(x * 0.018, y * 0.018, seed + zone);
  let bias = 1;
  if (zone === COMMERCIAL) bias += dCenter * 2.6 + s * 4 + dSeed * 0.7;
  else if (zone === INDUSTRIAL) bias += Math.abs(coast - Math.max(2, coastInset * 0.5)) * 0.045 + Math.max(0, 0.2 - dCenter) * 1.0 + s * 3.2 + dSeed * 0.35;
  else if (zone === RESIDENTIAL) bias += Math.abs(dCenter - 0.4) * 1.1 + s * 2.4 + dSeed * 0.45;
  else if (zone === SUBURB) bias += Math.max(0, 0.5 - dCenter) * 1.6 + s * 1.6 + dSeed * 0.25;
  const slopePenalty = Math.abs(h - ph) * 8 + s * 1.5;
  return bias + slopePenalty + noise * 0.18;
}

function growUrbanZones(urbanMask: Grid, seeds: ZoneSeed[], coastDist: Grid, slope: Grid, heightMap: Grid | null, center: Point, compBounds: Bounds, coastInset: number, seed: number): Grid {
  const rows = urbanMask.length;
  const cols = urbanMask[0]?.length ?? 0;
  const out = makeGrid(rows, cols, 0);
  if (seeds.length === 0) return out;
  const diag = Math.max(1, Math.hypot(compBounds.maxX - compBounds.minX + 1, compBounds.maxY - compBounds.minY + 1));
  const best = new Float64Array(rows * cols);
  best.fill(Infinity);
  const heap = new MinHeap();
  for (const s of seeds) {
    const x = clamp(Math.round(s.x), 0, cols - 1);
    const y = clamp(Math.round(s.y), 0, rows - 1);
    if (!urbanMask[y]?.[x]) continue;
    const idx = y * cols + x;
    best[idx] = 0;
    out[y][x] = s.zone;
    heap.push({ idx, priority: 0, zone: s.zone, seedX: x, seedY: y });
  }
  while (heap.length > 0) {
    const cur = heap.pop();
    if (!cur) break;
    if (cur.priority > best[cur.idx] + 1e-6) continue;
    const x = cur.idx % cols;
    const y = Math.floor(cur.idx / cols);
    for (const [dx, dy, step] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !urbanMask[ny]?.[nx]) continue;
      const ni = ny * cols + nx;
      const cost = cur.priority + step * zoneStepCost(cur.zone, nx, ny, x, y, cur.seedX, cur.seedY, coastDist, slope, heightMap, center, diag, coastInset, seed);
      if (cost >= best[ni]) continue;
      best[ni] = cost;
      out[ny][nx] = cur.zone;
      heap.push({ idx: ni, priority: cost, zone: cur.zone, seedX: cur.seedX, seedY: cur.seedY });
    }
  }
  return out;
}

// 在城市片区内挖出中央公园（避开商业/工业核心）。
function applyParkPatches(zoneGrid: Grid, urbanMask: Grid, comp: Component, coastDist: Grid, slope: Grid, center: Point, parkDensity: number, seed: number): void {
  if (parkDensity <= 0) return;
  const diag = Math.max(1, Math.hypot(comp.bounds.maxX - comp.bounds.minX + 1, comp.bounds.maxY - comp.bounds.minY + 1));
  // 数量很少：通常 1 个大型中央公园
  const count = clamp(Math.round((Math.sqrt(comp.area) / 240 + 0.4) * parkDensity), 1, 2);
  const centers = farthestCells(
    comp.cells.filter(c => urbanMask[c.y]?.[c.x] && zoneGrid[c.y]?.[c.x] !== COMMERCIAL && zoneGrid[c.y]?.[c.x] !== INDUSTRIAL),
    count,
    cell => {
      const s = slope[cell.y]?.[cell.x] ?? 0;
      const coast = coastDist[cell.y]?.[cell.x] ?? 0;
      const dCenter = Math.hypot(cell.x - center.x, cell.y - center.y) / diag;
      const waterEdge = 1 - clamp(Math.abs(coast - 8) / 20, 0, 1);
      return s * 4 + waterEdge * 0.7 + dCenter * 0.25 + valueNoise(cell.x * 0.04, cell.y * 0.04, seed) * 0.4;
    },
    seed + 907,
    Math.max(28, diag * 0.26),
  );
  centers.forEach((p, i) => {
    // 半径更大（单个大型中央公园）
    const rx = Math.max(10, diag * (0.1 + hash2(p.x, p.y, seed + i) * 0.05));
    const ry = Math.max(9, rx * (0.72 + hash2(p.y, p.x, seed + i + 17) * 0.45));
    const angle = hash2(p.x, p.y, seed + i + 31) * Math.PI;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const minX = Math.max(0, Math.floor(p.x - rx * 1.2));
    const maxX = Math.min(zoneGrid[0].length - 1, Math.ceil(p.x + rx * 1.2));
    const minY = Math.max(0, Math.floor(p.y - ry * 1.2));
    const maxY = Math.min(zoneGrid.length - 1, Math.ceil(p.y + ry * 1.2));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!urbanMask[y]?.[x]) continue;
        const current = zoneGrid[y]?.[x] ?? 0;
        if (current === COMMERCIAL || current === INDUSTRIAL) continue;
        const dx = x - p.x;
        const dy = y - p.y;
        const ux = (dx * ca + dy * sa) / rx;
        const uy = (-dx * sa + dy * ca) / ry;
        const n = valueNoise(x * 0.05, y * 0.05, seed + i * 37);
        if (ux * ux + uy * uy <= 0.75 + n * 0.32) zoneGrid[y][x] = PARK;
      }
    }
  });
}

// 仅在指定掩码内对指定分区集合做多数表决平滑。
function smoothZones(zoneGrid: Grid, mask: Grid, zoneSet: Set<number>, iterations: number): Grid {
  let cur = zoneGrid;
  const rows = zoneGrid.length;
  const cols = zoneGrid[0]?.length ?? 0;
  for (let iter = 0; iter < iterations; iter++) {
    const next = cur.map(row => row.slice());
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!mask[y]?.[x] || !zoneSet.has(cur[y][x])) continue;
        const counts = new Map<number, number>();
        for (const [dx, dy] of DIR8) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !mask[ny]?.[nx]) continue;
          const v = cur[ny]?.[nx] ?? 0;
          if (zoneSet.has(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        let bestZone = cur[y][x];
        let bestCount = 0;
        for (const [zone, count] of counts) {
          if (count > bestCount) {
            bestCount = count;
            bestZone = zone;
          }
        }
        if (bestZone !== cur[y][x] && bestCount >= 5) next[y][x] = bestZone;
      }
    }
    cur = next;
  }
  return cur;
}

// 去斑 + 补洞：若某像素的 8 邻居中有某个其他分区占强多数（>=threshold），
// 则翻转为该分区。可消除内部小块/单点空洞，比普通平滑更激进。
function despeckle(zoneGrid: Grid, mask: Grid, zoneSet: Set<number>, threshold: number, iterations: number): Grid {
  let cur = zoneGrid;
  const rows = zoneGrid.length;
  const cols = zoneGrid[0]?.length ?? 0;
  for (let iter = 0; iter < iterations; iter++) {
    const next = cur.map(row => row.slice());
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!mask[y]?.[x] || !zoneSet.has(cur[y][x])) continue;
        const counts = new Map<number, number>();
        let neighborTotal = 0;
        for (const [dx, dy] of DIR8) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !mask[ny]?.[nx]) continue;
          const v = cur[ny]?.[nx] ?? 0;
          if (zoneSet.has(v)) { counts.set(v, (counts.get(v) ?? 0) + 1); neighborTotal++; }
        }
        let bestZone = cur[y][x];
        let bestCount = 0;
        for (const [zone, count] of counts) {
          if (count > bestCount) { bestCount = count; bestZone = zone; }
        }
        // 强多数且与自身不同 → 翻转（同时覆盖单点空洞）
        if (bestZone !== cur[y][x] && bestCount >= threshold && bestCount >= neighborTotal - 1) {
          next[y][x] = bestZone;
        }
      }
    }
    cur = next;
  }
  return cur;
}

// 全局封闭区域合并：在整块陆地上，把"被单一其他分区高度包围、且面积不超过 maxArea"
// 的连通区域并入该包围分区。用于清除嵌在住宅等大区内部的绿块/公园/碎片，
// 同时保留大型开放区域（外围绿化带、海岸环、大型中央公园因面积超阈值而幸存）。
function mergeEnclosedRegions(zoneGrid: Grid, land: Grid, maxArea: number, enclosureRatio: number): Grid {
  const rows = zoneGrid.length;
  const cols = zoneGrid[0]?.length ?? 0;
  const out = zoneGrid.map(row => row.slice());
  const seen = new Uint8Array(rows * cols);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const start = y * cols + x;
      const zone = zoneGrid[y][x];
      if (seen[start] || !land[y]?.[x] || zone <= 0) continue;
      const cells: Cell[] = [];
      const queue = [start];
      seen[start] = 1;
      for (let head = 0; head < queue.length; head++) {
        const idx = queue[head];
        const cx = idx % cols;
        const cy = Math.floor(idx / cols);
        cells.push({ x: cx, y: cy, idx });
        for (const [dx, dy] of DIR4) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (seen[ni] || !land[ny]?.[nx] || zoneGrid[ny][nx] !== zone) continue;
          seen[ni] = 1;
          queue.push(ni);
        }
      }
      if (cells.length > maxArea) continue;
      // 统计 8 邻域内其他分区的边界占比
      const counts = new Map<number, number>();
      let total = 0;
      for (const c of cells) {
        for (const [dx, dy] of DIR8) {
          const nx = c.x + dx;
          const ny = c.y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !land[ny]?.[nx]) continue;
          const v = zoneGrid[ny][nx];
          if (v > 0 && v !== zone) { counts.set(v, (counts.get(v) ?? 0) + 1); total++; }
        }
      }
      if (total === 0) continue;
      let dominant = 0;
      let best = 0;
      for (const [v, cnt] of counts) if (cnt > best) { best = cnt; dominant = v; }
      if (dominant > 0 && best / total >= enclosureRatio) {
        for (const c of cells) out[c.y][c.x] = dominant;
      }
    }
  }
  return out;
}

function mergeSmallZoneFragments(zoneGrid: Grid, mask: Grid, zoneSet: number[], minArea: number): Grid {
  const rows = zoneGrid.length;
  const cols = zoneGrid[0]?.length ?? 0;
  const out = zoneGrid.map(row => row.slice());
  for (const zone of zoneSet) {
    const zoneMask = zoneGrid.map((row, y) => row.map((v, x) => mask[y]?.[x] && v === zone ? 1 : 0));
    for (const comp of maskComponents(zoneMask, 1)) {
      if (comp.area >= minArea) continue;
      const counts = new Map<number, number>();
      for (const cell of comp.cells) {
        for (const [dx, dy] of DIR8) {
          const nx = cell.x + dx;
          const ny = cell.y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !mask[ny]?.[nx]) continue;
          const v = out[ny]?.[nx] ?? 0;
          if (v > 0 && v !== zone) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
      let replacement = zone;
      let best = 0;
      for (const [v, count] of counts) {
        if (count > best) {
          best = count;
          replacement = v;
        }
      }
      if (replacement !== zone) for (const c of comp.cells) out[c.y][c.x] = replacement;
    }
  }
  return out;
}

export function gtaZones(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.landGrid)) return { error: "landGrid is required" };
  const landGrid = input.landGrid as Grid;
  const heightMap = isGrid(input.heightMap) ? input.heightMap as Grid : null;
  const seed = resolveSeed(input.seed);
  const coastInset = clamp(int(input, "coastInset", 6), 0, 60);
  const parkDensity = clamp(num(input, "parkDensity", 1), 0, 4);
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;

  // 陆地掩码
  const land = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (landGrid[y]?.[x]) land[y][x] = 1;

  // 地形分类（0=平原 1=沙滩 2=丘陵 3=山地）
  const cat = classifyTerrain(input, land, rows, cols, heightMap);
  const coastDist = distanceFromZero(land);
  const slope = slopeMap(land, heightMap);

  // 基础地形分区
  const zoneGridInit = makeGrid(rows, cols, 0);
  const plainsMask = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!land[y][x]) continue;
      const c = cat[y][x];
      if (c === 3) zoneGridInit[y][x] = MOUNTAIN;
      else if (c === 2) zoneGridInit[y][x] = GREENING;
      else if (c === 1) zoneGridInit[y][x] = BEACH;
      else plainsMask[y][x] = 1;  // 平原 → 待城市细分
    }
  }
  let zoneGrid = zoneGridInit;

  // 平原内细分城市功能区
  const minPlainsArea = Math.max(16, Math.round(rows * cols * 0.0008));
  const plainsComps = maskComponents(plainsMask, minPlainsArea);
  for (let i = 0; i < plainsComps.length; i++) {
    const comp = plainsComps[i];
    const center = componentCenter(comp.cells, coastDist, slope);
    const seeds = buildSeeds(comp, coastDist, slope, center, coastInset, seed + i * 1009);
    const grown = growUrbanZones(plainsMask, seeds, coastDist, slope, heightMap, center, comp.bounds, coastInset, seed + i * 2017);
    for (const c of comp.cells) {
      const v = grown[c.y]?.[c.x] ?? 0;
      if (v > 0) zoneGrid[c.y][c.x] = v;
    }
    applyParkPatches(zoneGrid, plainsMask, comp, coastDist, slope, center, parkDensity, seed + i * 311);
  }

  // 平原内未被生长覆盖的小片 → 住宅兜底
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (plainsMask[y][x] && zoneGrid[y][x] === 0) zoneGrid[y][x] = RESIDENTIAL;

  // 先对城市分区在平原内做平滑与碎片合并
  const urbanSet = new Set(URBAN_ZONES);
  zoneGrid = smoothZones(zoneGrid, plainsMask, urbanSet, 2);
  const minBlockArea = Math.max(60, Math.round(rows * cols * 0.003));
  zoneGrid = mergeSmallZoneFragments(zoneGrid, plainsMask, URBAN_ZONES, minBlockArea);
  // 公园单独用更高阈值过滤：只保留大型中央公园
  zoneGrid = mergeSmallZoneFragments(zoneGrid, plainsMask, [PARK], Math.max(120, Math.round(rows * cols * 0.006)));
  // 城市分区去斑 + 补洞
  zoneGrid = despeckle(zoneGrid, plainsMask, urbanSet, 6, 3);

  // ── 全局「只保留大块」过滤：对所有分区（含地形）在整块陆地上统一处理 ──
  const ALL_ZONES = [BEACH, COMMERCIAL, RESIDENTIAL, INDUSTRIAL, PARK, GREENING, MOUNTAIN, SUBURB];
  const allSet = new Set(ALL_ZONES);
  // 1) 封闭区域合并：清除嵌在大区内部的任意分区中小型口袋
  zoneGrid = mergeEnclosedRegions(zoneGrid, land, Math.round(rows * cols * 0.02), 0.78);
  // 2) 全局碎片合并：任意分区的小连通块并入相邻大区
  zoneGrid = mergeSmallZoneFragments(zoneGrid, land, ALL_ZONES, minBlockArea);
  // 3) 全局去斑 + 补洞：消除所有分区的残留小块与单点空洞
  zoneGrid = despeckle(zoneGrid, land, allSet, 6, 2);
  // 4) 全局平滑收边
  zoneGrid = smoothZones(zoneGrid, land, allSet, 1);

  const buildableMask = zoneGrid.map(row => row.map(v => v === COMMERCIAL || v === RESIDENTIAL || v === INDUSTRIAL || v === SUBURB ? 1 : 0));

  const used = new Set(zoneGrid.flat().filter(v => v !== 0));
  return {
    zoneGrid,
    buildableMask,
    outputGrid: zoneGrid,
    outputNameList: NAMES.filter(n => used.has(n.id)),
  };
}
