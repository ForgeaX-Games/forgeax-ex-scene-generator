type Grid = number[][];

interface Point { x: number; y: number; }
interface NameEntry { id: number; name: string; type?: string; }

const ARTERIAL = 300;
const CBD = 410;
const RESIDENTIAL = 411;
const INDUSTRIAL = 412;
const SUBURB = 414;
const BUILDABLE = new Set([CBD, RESIDENTIAL, INDUSTRIAL, SUBURB]);
const DIR4 = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

const NAMES: NameEntry[] = [
  { id: ARTERIAL, name: "城市主干路/环路", type: "tile" },
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

function maskFromDistricts(districtGrid: Grid, buildableMask: Grid | null, landGrid: Grid | null): Grid {
  const rows = districtGrid.length;
  const cols = districtGrid[0]?.length ?? 0;
  const out = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const district = districtGrid[y]?.[x] ?? 0;
      const buildable = buildableMask ? buildableMask[y]?.[x] > 0 : BUILDABLE.has(district);
      const land = landGrid ? landGrid[y]?.[x] > 0 : district > 0;
      if (land && (buildable || district === 413)) out[y][x] = 1;
    }
  }
  return out;
}

function centerOf(mask: Grid, districtGrid: Grid): Point {
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = 0; y < mask.length; y++) {
    for (let x = 0; x < (mask[0]?.length ?? 0); x++) {
      if (!mask[y]?.[x]) continue;
      const district = districtGrid[y]?.[x] ?? 0;
      const w = district === CBD ? 8 : district === RESIDENTIAL ? 2 : district === INDUSTRIAL ? 1.4 : 1;
      sx += x * w;
      sy += y * w;
      sw += w;
    }
  }
  return sw > 0 ? { x: sx / sw, y: sy / sw } : { x: 0, y: 0 };
}

function boundarySamples(mask: Grid, center: Point, count: number, seed: number): Point[] {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const buckets: Array<Point | null> = Array.from({ length: count }, () => null);
  const scores = new Array(count).fill(-Infinity);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y]?.[x]) continue;
      let edge = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
      for (const [dx, dy] of DIR4) if (!mask[y + dy]?.[x + dx]) edge = true;
      if (!edge) continue;
      const angle = Math.atan2(y - center.y, x - center.x);
      const bucket = Math.floor(((angle + Math.PI) / (Math.PI * 2)) * count) % count;
      const d = Math.hypot(x - center.x, y - center.y);
      const score = d + hash2(x, y, seed) * 6;
      if (score > scores[bucket]) {
        scores[bucket] = score;
        buckets[bucket] = { x, y };
      }
    }
  }
  return buckets.filter((p): p is Point => !!p);
}

function writeRoad(grid: Grid, mask: Grid, x: number, y: number, radius: number): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const r = Math.max(0, Math.round(radius));
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const nx = Math.round(x) + dx;
      const ny = Math.round(y) + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !mask[ny]?.[nx]) continue;
      grid[ny][nx] = ARTERIAL;
    }
  }
}

function drawPolyline(grid: Grid, mask: Grid, points: Point[], radius: number): void {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      writeRoad(grid, mask, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius);
    }
  }
}

function curvedPath(a: Point, b: Point, seed: number): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / d;
  const ny = dx / d;
  const bend = (hash2(Math.round(a.x + b.x), Math.round(a.y + b.y), seed) - 0.5) * d * 0.18;
  return [
    a,
    { x: a.x + dx * 0.33 + nx * bend, y: a.y + dy * 0.33 + ny * bend },
    { x: a.x + dx * 0.66 - nx * bend * 0.45, y: a.y + dy * 0.66 - ny * bend * 0.45 },
    b,
  ];
}

function ringPoint(center: Point, radius: number, angle: number, mask: Grid): Point | null {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  for (let scale = 1; scale > 0.25; scale -= 0.04) {
    const x = clamp(Math.round(center.x + Math.cos(angle) * radius * scale), 0, cols - 1);
    const y = clamp(Math.round(center.y + Math.sin(angle) * radius * scale), 0, rows - 1);
    if (mask[y]?.[x]) return { x, y };
  }
  return null;
}

function drawRing(grid: Grid, mask: Grid, center: Point, radius: number, radiusNoise: number, roadWidth: number, seed: number): void {
  const samples: Point[] = [];
  const count = 96;
  for (let i = 0; i <= count; i++) {
    const a = (i / count) * Math.PI * 2;
    const n = valueNoise(Math.cos(a) * 2.5 + 7, Math.sin(a) * 2.5 + 11, seed);
    const p = ringPoint(center, radius * (1 + (n - 0.5) * radiusNoise), a, mask);
    if (p) samples.push(p);
  }
  drawPolyline(grid, mask, samples, roadWidth);
}

export function gtaCityArterials(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.districtGrid)) return { error: "districtGrid is required" };
  const districtGrid = input.districtGrid as Grid;
  const buildableMask = isGrid(input.buildableMask) ? input.buildableMask as Grid : null;
  const landGrid = isGrid(input.landGrid) ? input.landGrid as Grid : null;
  const seed = resolveSeed(input.seed);
  const roadWidth = clamp(int(input, "roadWidth", 2), 0, 8);
  const ringCount = clamp(int(input, "ringCount", 2), 0, 4);
  const radialCount = clamp(int(input, "radialCount", 7), 3, 16);
  const mask = maskFromDistricts(districtGrid, buildableMask, landGrid);
  const rows = districtGrid.length;
  const cols = districtGrid[0]?.length ?? 0;
  const center = centerOf(mask, districtGrid);
  const arterialGrid = makeGrid(rows, cols, 0);
  const boundary = boundarySamples(mask, center, radialCount, seed + 101);
  const maxR = boundary.reduce((m, p) => Math.max(m, Math.hypot(p.x - center.x, p.y - center.y)), 0);

  for (let i = 0; i < ringCount; i++) {
    const radius = maxR * (0.28 + i * 0.18);
    drawRing(arterialGrid, mask, center, radius, 0.18, roadWidth, seed + i * 503);
  }

  boundary.forEach((p, i) => {
    const d = Math.hypot(p.x - center.x, p.y - center.y);
    if (d < maxR * 0.28) return;
    drawPolyline(arterialGrid, mask, curvedPath(center, p, seed + i * 997), roadWidth);
  });

  for (let i = 1; i < boundary.length; i += 2) {
    const a = boundary[i - 1];
    const b = boundary[i];
    if (!a || !b) continue;
    drawPolyline(arterialGrid, mask, curvedPath(a, b, seed + i * 313), Math.max(0, roadWidth - 1));
  }

  return {
    arterialGrid,
    roadGrid: arterialGrid,
    outputGrid: arterialGrid,
    outputNameList: NAMES,
  };
}
