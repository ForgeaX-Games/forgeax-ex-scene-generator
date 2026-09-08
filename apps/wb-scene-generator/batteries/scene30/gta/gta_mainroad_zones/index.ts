type Grid = number[][];

interface NameEntry {
  id: number;
  name: string;
  type?: string;
}

interface Point { x: number; y: number; }
interface Bounds { minX: number; minY: number; maxX: number; maxY: number; has: boolean; }

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

function bool(input: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof input[key] === "boolean" ? input[key] as boolean : fallback;
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

function boundsOf(mask: Grid): Bounds {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const out: Bounds = { minX: cols, minY: rows, maxX: 0, maxY: 0, has: false };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y]?.[x]) continue;
      out.has = true;
      out.minX = Math.min(out.minX, x);
      out.minY = Math.min(out.minY, y);
      out.maxX = Math.max(out.maxX, x);
      out.maxY = Math.max(out.maxY, y);
    }
  }
  return out;
}

function largestCountryId(countryGrid: Grid): number {
  const counts = new Map<number, number>();
  for (const row of countryGrid) {
    for (const v of row) if (v > 0) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let bestId = 0;
  let best = 0;
  for (const [id, count] of counts) {
    if (count > best) {
      best = count;
      bestId = id;
    }
  }
  return bestId;
}

function targetMask(landGrid: Grid, countryGrid: Grid, largestOnly: boolean): Grid {
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const target = largestOnly ? largestCountryId(countryGrid) : 0;
  const out = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const country = countryGrid[y]?.[x] ?? 0;
      if (landGrid[y]?.[x] && country > 0 && (!target || country === target)) out[y][x] = country;
    }
  }
  return out;
}

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
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
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
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(nx, ny) || dist[ny][nx] <= dist[y][x] + 1) continue;
      dist[ny][nx] = dist[y][x] + 1;
      queue.push(ny * cols + nx);
    }
  }
  return dist;
}

function weightedCenter(mask: Grid, coastDist?: Grid, heightMap?: Grid | null): Point {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y]?.[x]) continue;
      const h = heightMap ? (heightMap[y]?.[x] ?? 0.55) : 0.55;
      const d = coastDist ? Math.min(36, coastDist[y]?.[x] ?? 0) : 12;
      const w = (1 + d) * clamp(1.2 - Math.max(0, h - 0.68) * 2, 0.25, 1.2);
      sx += x * w;
      sy += y * w;
      sw += w;
    }
  }
  return sw > 0 ? { x: sx / sw, y: sy / sw } : { x: cols / 2, y: rows / 2 };
}

const NAMES: NameEntry[] = [
  { id: 410, name: "商业核心区", type: "tile" },
  { id: 411, name: "住宅区", type: "tile" },
  { id: 412, name: "工业港区", type: "tile" },
  { id: 413, name: "绿地公园", type: "tile" },
  { id: 414, name: "郊区低密度", type: "tile" },
];

export function gtaMainroadZones(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.landGrid)) return { error: "landGrid is required" };
  if (!isGrid(input.countryGrid)) return { error: "countryGrid is required" };
  const landGrid = input.landGrid as Grid;
  const countryGrid = input.countryGrid as Grid;
  const heightMap = isGrid(input.heightMap) ? input.heightMap as Grid : null;
  const seed = resolveSeed(input.seed);
  const coastInset = clamp(int(input, "coastInset", 10), 0, 80);
  const urbanCoverage = clamp(num(input, "urbanCoverage", 0.72), 0.1, 1);
  const largestOnly = bool(input, "largestCountryOnly", false);
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;

  const mask = targetMask(landGrid, countryGrid, largestOnly);
  const coastDist = distanceFromZero(mask);
  const bounds = boundsOf(mask);
  const center = weightedCenter(mask, coastDist, heightMap);
  const maxR = bounds.has ? Math.max(1, Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.55) : 1;
  const zoneGrid = makeGrid(rows, cols, 0);
  const buildableMask = makeGrid(rows, cols, 0);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y]?.[x]) continue;
      const h = heightMap ? (heightMap[y]?.[x] ?? 0.55) : 0.55;
      const dCoast = coastDist[y]?.[x] ?? 0;
      const dCenter = Math.hypot(x - center.x, y - center.y) / maxR;
      const n = valueNoise(x * 0.018, y * 0.018, seed);
      const buildScore = (1 - dCenter * 0.55) * 0.55 + clamp(dCoast / 42, 0, 1) * 0.25 + n * 0.2;
      if (dCoast < coastInset || h > 0.88 || buildScore < 1 - urbanCoverage) continue;
      buildableMask[y][x] = 1;

      if (dCenter < 0.22 && n > 0.22) zoneGrid[y][x] = 410;
      else if (dCoast < coastInset + 18 && h < 0.62 && n < 0.42) zoneGrid[y][x] = 412;
      else if (n > 0.78 && dCenter > 0.25) zoneGrid[y][x] = 413;
      else if (dCenter > 0.62 || n < 0.18) zoneGrid[y][x] = 414;
      else zoneGrid[y][x] = 411;
    }
  }

  const used = new Set(zoneGrid.flat().filter(v => v !== 0));
  return {
    zoneGrid,
    buildableMask,
    outputGrid: zoneGrid,
    outputNameList: NAMES.filter(n => used.has(n.id)),
  };
}
