type Grid = number[][];

interface NameEntry {
  id: number;
  name: string;
  type?: string;
}

interface CityPoint {
  id: number;
  countryId: number;
  x: number;
  y: number;
  kind: "capital" | "city";
}

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

const NAMES: NameEntry[] = [
  { id: 200, name: "首都", type: "tile" },
  { id: 201, name: "城市", type: "tile" },
];

interface RegionAcc {
  sx: number;
  sy: number;
  n: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  candidates: Array<{ x: number; y: number; countryId: number; score: number }>;
}

function scoreCityCell(x: number, y: number, heightMap: Grid | null, seed: number): number {
  const h = heightMap ? (heightMap[y]?.[x] ?? 0.5) : 0.5;
  const habitable = 1 - Math.abs(h - 0.56) * 1.35;
  const plainBias = clamp(1.1 - Math.max(0, h - 0.68) * 2.4, 0.15, 1.1);
  const localNoise = hash2(Math.floor(x / 5), Math.floor(y / 5), seed);
  return clamp(habitable, 0.15, 1) * 0.48 + plainBias * 0.32 + localNoise * 0.2;
}

function placeCity(grid: Grid, points: CityPoint[], nextId: number, candidate: { x: number; y: number; countryId: number }, kind: "capital" | "city"): number {
  if (grid[candidate.y]?.[candidate.x]) return nextId;
  points.push({ id: nextId, countryId: candidate.countryId, x: candidate.x, y: candidate.y, kind });
  grid[candidate.y][candidate.x] = kind === "capital" ? 200 : 201;
  return nextId + 1;
}

export function worldmapCities(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.landGrid)) return { error: "landGrid is required" };
  if (!isGrid(input.countryGrid)) return { error: "countryGrid is required" };
  const landGrid = input.landGrid as Grid;
  const countryGrid = input.countryGrid as Grid;
  const heightMap = isGrid(input.heightMap) ? input.heightMap as Grid : null;
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const seed = resolveSeed(input.seed) + 1777;
  const cityCount = clamp(int(input, "cityCount", 56), 0, 240);
  const minRegionArea = clamp(int(input, "minRegionArea", Math.max(90, Math.floor(rows * cols / 2200))), 1, rows * cols);

  const regions = new Map<number, RegionAcc>();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const countryId = countryGrid[y]?.[x] ?? 0;
      if (!countryId || !landGrid[y]?.[x]) continue;
      const acc = regions.get(countryId) ?? { sx: 0, sy: 0, n: 0, minX: x, minY: y, maxX: x, maxY: y, candidates: [] };
      acc.sx += x;
      acc.sy += y;
      acc.n++;
      acc.minX = Math.min(acc.minX, x);
      acc.minY = Math.min(acc.minY, y);
      acc.maxX = Math.max(acc.maxX, x);
      acc.maxY = Math.max(acc.maxY, y);
      const sampleGate = hash2(x, y, seed + countryId * 31);
      if (sampleGate < 0.3) {
        const score = scoreCityCell(x, y, heightMap, seed + countryId * 97) + hash2(x + 17, y + 23, seed) * 0.18;
        acc.candidates.push({ x, y, countryId, score });
      }
      regions.set(countryId, acc);
    }
  }

  const cityGrid = makeGrid(rows, cols, 0);
  const cityPoints: CityPoint[] = [];
  let nextId = 1;
  const eligibleRegions = [...regions.entries()]
    .filter(([, acc]) => acc.n >= minRegionArea)
    .map(([countryId, acc]) => {
      if (acc.candidates.length === 0) {
        const x = Math.round(acc.sx / acc.n);
        const y = Math.round(acc.sy / acc.n);
        acc.candidates.push({ x, y, countryId, score: scoreCityCell(x, y, heightMap, seed) });
      }
      acc.candidates.sort((a, b) => b.score - a.score);
      return { countryId, acc };
    })
    .sort((a, b) => b.acc.n - a.acc.n);

  const capitalTarget = Math.min(eligibleRegions.length, Math.max(1, Math.floor(cityCount * 0.45)));
  for (const { acc } of eligibleRegions.slice(0, capitalTarget)) {
    const capital = acc.candidates[0];
    nextId = placeCity(cityGrid, cityPoints, nextId, capital, "capital");
  }

  const candidates = eligibleRegions.flatMap(({ acc }) => acc.candidates.slice(1, Math.max(2, Math.ceil(acc.n / Math.max(1, minRegionArea)))));
  candidates.sort((a, b) => b.score - a.score);
  const minDist = Math.max(9, Math.round(Math.min(rows, cols) / 45));
  const minDist2 = minDist * minDist;
  for (const c of candidates) {
    if (cityPoints.length >= cityCount) break;
    if (cityPoints.some(p => (p.x - c.x) ** 2 + (p.y - c.y) ** 2 < minDist2)) continue;
    nextId = placeCity(cityGrid, cityPoints, nextId, c, "city");
  }

  return { cityGrid, cityPoints, outputGrid: cityGrid, outputNameList: NAMES };
}
