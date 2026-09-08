type Grid = number[][];

interface NameEntry { id: number; name: string; type?: string; }

const CBD = 410;
const RESIDENTIAL = 411;
const INDUSTRIAL = 412;
const SUBURB = 414;
const B_CBD = 500;
const B_RESIDENTIAL = 501;
const B_INDUSTRIAL = 502;
const B_SUBURB = 503;

const NAMES: NameEntry[] = [
  { id: B_CBD, name: "商业高密建筑", type: "tile" },
  { id: B_RESIDENTIAL, name: "住宅楼块", type: "tile" },
  { id: B_INDUSTRIAL, name: "工业大盒", type: "tile" },
  { id: B_SUBURB, name: "郊区小屋", type: "tile" },
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

function spec(zone: number): { value: number; step: number; minW: number; maxW: number; minH: number; maxH: number; chance: number } | null {
  if (zone === CBD) return { value: B_CBD, step: 16, minW: 5, maxW: 13, minH: 6, maxH: 16, chance: 0.94 };
  if (zone === RESIDENTIAL) return { value: B_RESIDENTIAL, step: 23, minW: 6, maxW: 17, minH: 7, maxH: 20, chance: 0.74 };
  if (zone === INDUSTRIAL) return { value: B_INDUSTRIAL, step: 42, minW: 17, maxW: 38, minH: 14, maxH: 34, chance: 0.72 };
  if (zone === SUBURB) return { value: B_SUBURB, step: 34, minW: 5, maxW: 12, minH: 5, maxH: 13, chance: 0.38 };
  return null;
}

function roadDistanceOk(roadGrid: Grid, x: number, y: number, minDist: number, maxDist: number): boolean {
  let best = 999999;
  for (let dy = -maxDist; dy <= maxDist; dy++) {
    for (let dx = -maxDist; dx <= maxDist; dx++) {
      if ((roadGrid[y + dy]?.[x + dx] ?? 0) < 300) continue;
      best = Math.min(best, Math.hypot(dx, dy));
    }
  }
  return best >= minDist && best <= maxDist;
}

function rectFits(districtGrid: Grid, roadGrid: Grid, parcelGrid: Grid, buildingGrid: Grid, x0: number, y0: number, w: number, h: number, zone: number, minRoadDist: number, maxRoadDist: number): boolean {
  const rows = districtGrid.length;
  const cols = districtGrid[0]?.length ?? 0;
  if (x0 < 0 || y0 < 0 || x0 + w >= cols || y0 + h >= rows) return false;
  let roadOk = false;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (districtGrid[y]?.[x] !== zone) return false;
      if (!parcelGrid[y]?.[x]) return false;
      if (buildingGrid[y]?.[x]) return false;
      if ((roadGrid[y]?.[x] ?? 0) >= 300) return false;
      roadOk = roadOk || roadDistanceOk(roadGrid, x, y, minRoadDist, maxRoadDist);
    }
  }
  return roadOk;
}

function fillRect(grid: Grid, x0: number, y0: number, w: number, h: number, value: number): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) grid[y][x] = value;
  }
}

export function gtaCityBuildings(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.districtGrid)) return { error: "districtGrid is required" };
  if (!isGrid(input.roadGrid)) return { error: "roadGrid is required" };
  if (!isGrid(input.parcelGrid)) return { error: "parcelGrid is required" };
  const districtGrid = input.districtGrid as Grid;
  const roadGrid = input.roadGrid as Grid;
  const parcelGrid = input.parcelGrid as Grid;
  const rows = districtGrid.length;
  const cols = districtGrid[0]?.length ?? 0;
  const seed = resolveSeed(input.seed);
  const density = clamp(num(input, "density", 0.68), 0, 1);
  const minRoadDist = clamp(int(input, "minRoadDist", 2), 0, 16);
  const maxRoadDist = clamp(int(input, "maxRoadDist", 18), 3, 80);
  const buildingGrid = makeGrid(rows, cols, 0);

  for (let y = 0; y < rows; y += 3) {
    for (let x = 0; x < cols; x += 3) {
      const zone = districtGrid[y]?.[x] ?? 0;
      const s = spec(zone);
      if (!s || !parcelGrid[y]?.[x]) continue;
      const gridStep = Math.max(8, Math.round(s.step * (0.82 + hash2(x, y, seed + zone) * 0.35)));
      if (x % gridStep > 2 || y % gridStep > 2) continue;
      if (hash2(x, y, seed + 31) > s.chance * density) continue;
      const w = Math.round(s.minW + (s.maxW - s.minW) * hash2(x + 17, y + 3, seed));
      const h = Math.round(s.minH + (s.maxH - s.minH) * hash2(x + 5, y + 29, seed));
      const x0 = x + Math.floor((gridStep - w) * (hash2(x + 11, y + 13, seed) - 0.5) * 0.35);
      const y0 = y + Math.floor((gridStep - h) * (hash2(x + 19, y + 7, seed) - 0.5) * 0.35);
      if (!rectFits(districtGrid, roadGrid, parcelGrid, buildingGrid, x0, y0, w, h, zone, minRoadDist, maxRoadDist)) continue;
      fillRect(buildingGrid, x0, y0, w, h, s.value);
    }
  }

  const used = new Set(buildingGrid.flat().filter(v => v !== 0));
  return {
    buildingGrid,
    outputGrid: buildingGrid,
    outputNameList: NAMES.filter(n => used.has(n.id)),
  };
}
