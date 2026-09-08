type Grid = number[][];

interface Point { x: number; y: number; }
interface NameEntry { id: number; name: string; type?: string; }

const CBD = 410;
const RESIDENTIAL = 411;
const INDUSTRIAL = 412;
const SUBURB = 414;
const PARCEL_CBD = 420;
const PARCEL_RESIDENTIAL = 421;
const PARCEL_INDUSTRIAL = 422;
const PARCEL_SUBURB = 423;
const DIR4 = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

const NAMES: NameEntry[] = [
  { id: PARCEL_CBD, name: "商业地块", type: "tile" },
  { id: PARCEL_RESIDENTIAL, name: "住宅地块", type: "tile" },
  { id: PARCEL_INDUSTRIAL, name: "工业地块", type: "tile" },
  { id: PARCEL_SUBURB, name: "郊区地块", type: "tile" },
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

function parcelValue(zone: number): number {
  if (zone === CBD) return PARCEL_CBD;
  if (zone === RESIDENTIAL) return PARCEL_RESIDENTIAL;
  if (zone === INDUSTRIAL) return PARCEL_INDUSTRIAL;
  if (zone === SUBURB) return PARCEL_SUBURB;
  return 0;
}

function isRoad(roadGrid: Grid, x: number, y: number, setback: number): boolean {
  for (let dy = -setback; dy <= setback; dy++) {
    for (let dx = -setback; dx <= setback; dx++) {
      if ((roadGrid[y + dy]?.[x + dx] ?? 0) >= 300) return true;
    }
  }
  return false;
}

function dominantZone(cells: Point[], districtGrid: Grid): number {
  const counts = new Map<number, number>();
  for (const p of cells) {
    const v = districtGrid[p.y]?.[p.x] ?? 0;
    if (parcelValue(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let bestZone = 0;
  let bestCount = 0;
  for (const [zone, count] of counts) {
    if (count > bestCount) {
      bestZone = zone;
      bestCount = count;
    }
  }
  return bestZone;
}

export function gtaCityParcels(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.districtGrid)) return { error: "districtGrid is required" };
  if (!isGrid(input.roadGrid)) return { error: "roadGrid is required" };
  const districtGrid = input.districtGrid as Grid;
  const roadGrid = input.roadGrid as Grid;
  const rows = districtGrid.length;
  const cols = districtGrid[0]?.length ?? 0;
  const minParcelArea = clamp(int(input, "minParcelArea", 24), 1, 20000);
  const roadSetback = clamp(int(input, "roadSetback", 1), 0, 8);
  const parcelGrid = makeGrid(rows, cols, 0);
  const developable = makeGrid(rows, cols, 0);
  const seen = new Uint8Array(rows * cols);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!parcelValue(districtGrid[y]?.[x] ?? 0)) continue;
      if (isRoad(roadGrid, x, y, roadSetback)) continue;
      developable[y][x] = 1;
    }
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const start = y * cols + x;
      if (seen[start] || !developable[y]?.[x]) continue;
      const queue = [start];
      const cells: Point[] = [];
      seen[start] = 1;
      for (let head = 0; head < queue.length; head++) {
        const idx = queue[head];
        const cx = idx % cols;
        const cy = Math.floor(idx / cols);
        cells.push({ x: cx, y: cy });
        for (const [dx, dy] of DIR4) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (seen[ni] || !developable[ny]?.[nx]) continue;
          seen[ni] = 1;
          queue.push(ni);
        }
      }
      if (cells.length < minParcelArea) continue;
      const value = parcelValue(dominantZone(cells, districtGrid));
      if (!value) continue;
      for (const p of cells) parcelGrid[p.y][p.x] = value;
    }
  }

  const used = new Set(parcelGrid.flat().filter(v => v !== 0));
  return {
    parcelGrid,
    developableMask: developable,
    outputGrid: parcelGrid,
    outputNameList: NAMES.filter(n => used.has(n.id)),
  };
}
