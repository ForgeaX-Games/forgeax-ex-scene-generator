type Grid = number[][];

interface NameEntry { id: number; name: string; type?: string; }

const ARTERIAL = 300;
const STREET = 301;
const CBD = 410;
const RESIDENTIAL = 411;
const INDUSTRIAL = 412;
const PARK = 413;
const SUBURB = 414;

const NAMES: NameEntry[] = [
  { id: ARTERIAL, name: "城市主干路", type: "tile" },
  { id: STREET, name: "城市街巷", type: "tile" },
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

function zoneSpacing(zone: number, base: number): number {
  if (zone === CBD) return Math.max(8, base * 0.52);
  if (zone === RESIDENTIAL) return Math.max(10, base * 0.78);
  if (zone === INDUSTRIAL) return Math.max(16, base * 1.35);
  if (zone === SUBURB) return Math.max(18, base * 1.75);
  return Math.max(24, base * 2.1);
}

function zoneAngle(zone: number, x: number, y: number, seed: number): number {
  const palette = zone === CBD
    ? [0, Math.PI / 2, Math.PI * 0.08]
    : zone === INDUSTRIAL
      ? [Math.PI * 0.02, Math.PI * 0.5]
      : zone === SUBURB
        ? [Math.PI * 0.14, Math.PI * -0.08]
        : [0, Math.PI * 0.5, Math.PI * 0.1, Math.PI * -0.1];
  return palette[Math.floor(hash2(Math.floor(x / 80), Math.floor(y / 80), seed + zone) * palette.length) % palette.length];
}

function hasRoadNear(grid: Grid, x: number, y: number, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if ((grid[y + dy]?.[x + dx] ?? 0) >= 300) return true;
    }
  }
  return false;
}

function writeCell(grid: Grid, mask: Grid, x: number, y: number, radius: number): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const r = Math.max(0, Math.round(radius));
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !mask[ny]?.[nx]) continue;
      if (grid[ny]?.[nx] === ARTERIAL) continue;
      grid[ny][nx] = STREET;
    }
  }
}

function buildCityMask(districtGrid: Grid): Grid {
  return districtGrid.map(row => row.map(v => v === CBD || v === RESIDENTIAL || v === INDUSTRIAL || v === SUBURB ? 1 : 0));
}

export function gtaCityStreets(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.districtGrid)) return { error: "districtGrid is required" };
  if (!isGrid(input.arterialGrid) && !isGrid(input.roadGrid)) return { error: "arterialGrid or roadGrid is required" };
  const districtGrid = input.districtGrid as Grid;
  const arterialGrid = (isGrid(input.arterialGrid) ? input.arterialGrid : input.roadGrid) as Grid;
  const rows = districtGrid.length;
  const cols = districtGrid[0]?.length ?? 0;
  const seed = resolveSeed(input.seed);
  const baseSpacing = clamp(int(input, "baseSpacing", 30), 8, 120);
  const roadWidth = clamp(int(input, "roadWidth", 0), 0, 4);
  const density = clamp(num(input, "density", 0.74), 0, 1);
  const cityMask = buildCityMask(districtGrid);
  const streetGrid = makeGrid(rows, cols, 0);
  const roadGrid = arterialGrid.map(row => row.slice());

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const zone = districtGrid[y]?.[x] ?? 0;
      if (!cityMask[y]?.[x] || zone === PARK || arterialGrid[y]?.[x]) continue;
      if (!hasRoadNear(arterialGrid, x, y, Math.round(baseSpacing * 3.8)) && zone !== CBD) continue;
      const spacing = zoneSpacing(zone, baseSpacing);
      const angle = zoneAngle(zone, x, y, seed);
      const ca = Math.cos(angle);
      const sa = Math.sin(angle);
      const u = x * ca + y * sa;
      const v = -x * sa + y * ca;
      const jitter = (hash2(Math.floor(x / spacing), Math.floor(y / spacing), seed + zone * 11) - 0.5) * spacing * 0.16;
      const lineA = Math.abs(((u + jitter) % spacing + spacing) % spacing) < 0.55;
      const lineB = Math.abs(((v - jitter) % spacing + spacing) % spacing) < 0.55;
      const keep = zone === CBD ? 0.98 : zone === RESIDENTIAL ? 0.82 : zone === INDUSTRIAL ? 0.58 : 0.36;
      if ((lineA || lineB) && hash2(Math.floor(u / spacing), Math.floor(v / spacing), seed + 71) < keep * density) {
        writeCell(streetGrid, cityMask, x, y, roadWidth);
        if (!roadGrid[y]?.[x]) roadGrid[y][x] = STREET;
      }
    }
  }

  return {
    streetGrid,
    roadGrid,
    outputGrid: roadGrid,
    outputNameList: NAMES,
  };
}
