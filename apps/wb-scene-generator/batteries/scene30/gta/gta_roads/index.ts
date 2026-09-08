type Grid = number[][];

interface NameEntry {
  id: number;
  name: string;
  type?: string;
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

interface Point {
  x: number;
  y: number;
}

interface RoadCenter extends Point {
  id: number;
  countryId: number;
}

const ROAD_NAMES: NameEntry[] = [
  { id: 300, name: "城市主干路", type: "tile" },
  { id: 301, name: "街区道路", type: "tile" },
];

interface Bounds { minX: number; minY: number; maxX: number; maxY: number; has: boolean; }

function largestCountryId(countryGrid: Grid): number {
  const counts = new Map<number, number>();
  for (const row of countryGrid) {
    for (const v of row) {
      if (v > 0) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  let bestId = 0;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      bestId = id;
      bestCount = count;
    }
  }
  return bestId;
}

function buildTargetMask(landGrid: Grid, countryGrid: Grid, largestOnly: boolean): Grid {
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const targetCountry = largestOnly ? largestCountryId(countryGrid) : 0;
  const mask = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const countryId = countryGrid[y]?.[x] ?? 0;
      if (landGrid[y]?.[x] && countryId > 0 && (!targetCountry || countryId === targetCountry)) {
        mask[y][x] = countryId;
      }
    }
  }
  return mask;
}

function maskBounds(mask: Grid): Bounds {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const out: Bounds = { minX: cols, minY: rows, maxX: 0, maxY: 0, has: false };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y][x]) continue;
      out.has = true;
      out.minX = Math.min(out.minX, x);
      out.minY = Math.min(out.minY, y);
      out.maxX = Math.max(out.maxX, x);
      out.maxY = Math.max(out.maxY, y);
    }
  }
  return out;
}

function distanceFromEdge(mask: Grid): Grid {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const dist = makeGrid(rows, cols, 0).map(row => row.map(() => Infinity));
  const queue: number[] = [];
  let head = 0;
  const isBuildable = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && mask[y][x] > 0;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y][x]) continue;
      let touchesEdge = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (!isBuildable(x + dx, y + dy)) touchesEdge = true;
      }
      if (touchesEdge) {
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
      if (!isBuildable(nx, ny) || dist[ny][nx] <= dist[y][x] + 1) continue;
      dist[ny][nx] = dist[y][x] + 1;
      queue.push(ny * cols + nx);
    }
  }

  return dist;
}

function makeUrbanMask(mask: Grid, coastDist: Grid, heightMap: Grid | null, coastInset: number): Grid {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const urban = makeGrid(rows, cols, 0);
  let count = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y][x]) continue;
      const h = heightMap ? (heightMap[y]?.[x] ?? 0.55) : 0.55;
      if (coastDist[y][x] >= coastInset && h < 0.86) {
        urban[y][x] = mask[y][x];
        count++;
      }
    }
  }

  // Small or highly coastal countries still need a road network; relax the inset before returning empty.
  if (count > 0) return urban;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) if (mask[y][x]) urban[y][x] = mask[y][x];
  }
  return urban;
}

function weightedCenter(mask: Grid, coastDist: Grid, heightMap: Grid | null): Point {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y][x]) continue;
      const h = heightMap ? (heightMap[y]?.[x] ?? 0.55) : 0.55;
      const w = (1 + Math.min(24, coastDist[y][x])) * clamp(1.1 - Math.max(0, h - 0.62) * 1.5, 0.2, 1.1);
      sx += x * w;
      sy += y * w;
      sw += w;
    }
  }
  return sw > 0 ? { x: sx / sw, y: sy / sw } : { x: cols / 2, y: rows / 2 };
}

function pickRoadCenters(
  mask: Grid,
  coastDist: Grid,
  districtCount: number,
  heightMap: Grid | null,
  seed: number
): RoadCenter[] {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const candidates: Array<{ idx: number; score: number }> = [];
  const center = weightedCenter(mask, coastDist, heightMap);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y][x]) continue;
      const h = heightMap ? (heightMap[y]?.[x] ?? 0.55) : 0.55;
      const edgeScore = clamp(coastDist[y][x] / Math.max(1, Math.min(rows, cols) * 0.18), 0, 1);
      const centerDist = Math.hypot(x - center.x, y - center.y) / Math.max(1, Math.min(rows, cols) * 0.45);
      const centerScore = clamp(1 - centerDist, 0, 1);
      const heightScore = clamp(1.1 - Math.max(0, h - 0.66) * 2.2, 0.15, 1.1);
      const noise = 0.82 + valueNoise(x * 0.025, y * 0.025, seed + 41) * 0.36;
      candidates.push({ idx: y * cols + x, score: (edgeScore * 0.35 + centerScore * 0.65) * heightScore * noise });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length === 0) return [];

  const centers: RoadCenter[] = [];
  const first = candidates[0].idx;
  centers.push({ id: 1, countryId: mask[Math.floor(first / cols)][first % cols], x: first % cols, y: Math.floor(first / cols) });

  while (centers.length < districtCount && centers.length < candidates.length) {
    let best = candidates[0];
    let bestScore = -Infinity;
    for (const c of candidates) {
      const x = c.idx % cols;
      const y = Math.floor(c.idx / cols);
      let minD2 = Infinity;
      for (const p of centers) minD2 = Math.min(minD2, (p.x - x) ** 2 + (p.y - y) ** 2);
      const score = minD2 * c.score;
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    centers.push({
      id: centers.length + 1,
      countryId: mask[Math.floor(best.idx / cols)][best.idx % cols],
      x: best.idx % cols,
      y: Math.floor(best.idx / cols),
    });
  }

  return centers;
}

function drawMaskedDisk(grid: Grid, mask: Grid, cx: number, cy: number, radius: number, value: number): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const r = Math.max(0, Math.round(radius));
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = Math.round(cx) + dx;
      const y = Math.round(cy) + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows || !mask[y][x]) continue;
      grid[y][x] = value;
    }
  }
}

function drawClippedLine(grid: Grid, mask: Grid, a: Point, b: Point, radius: number, value: number, minRun = 4): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  let run: Point[] = [];
  const flush = () => {
    if (run.length >= minRun) for (const p of run) drawMaskedDisk(grid, mask, p.x, p.y, radius, value);
    run = [];
  };
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    if (x < 0 || y < 0 || x >= cols || y >= rows || !mask[y][x]) {
      flush();
    } else if (run.length === 0 || run[run.length - 1].x !== x || run[run.length - 1].y !== y) {
      run.push({ x, y });
    }
  }
  flush();
}

function connectCenters(grid: Grid, mask: Grid, centers: RoadCenter[], width: number): void {
  if (centers.length < 2) return;
  const edges: Array<{ a: number; b: number; d: number }> = [];
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const d = Math.hypot(centers[i].x - centers[j].x, centers[i].y - centers[j].y);
      edges.push({ a: i, b: j, d });
    }
  }
  edges.sort((a, b) => a.d - b.d);

  const parent = centers.map((_, i) => i);
  const find = (x: number): number => parent[x] === x ? x : (parent[x] = find(parent[x]));
  const used = new Set<string>();
  const add = (a: number, b: number) => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (used.has(key)) return;
    used.add(key);
    drawClippedLine(grid, mask, centers[a], centers[b], width, 300, 10);
  };

  for (const e of edges) {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra === rb) continue;
    parent[ra] = rb;
    add(e.a, e.b);
  }
}

function drawRingRoad(grid: Grid, mask: Grid, centers: RoadCenter[], width: number): void {
  if (centers.length < 4) return;
  const cx = centers.reduce((s, p) => s + p.x, 0) / centers.length;
  const cy = centers.reduce((s, p) => s + p.y, 0) / centers.length;
  const rx = Math.max(12, centers.reduce((s, p) => s + Math.abs(p.x - cx), 0) / centers.length * 1.45);
  const ry = Math.max(12, centers.reduce((s, p) => s + Math.abs(p.y - cy), 0) / centers.length * 1.45);
  const points: Point[] = [];
  for (let i = 0; i <= 96; i++) {
    const t = (i / 96) * Math.PI * 2;
    points.push({ x: Math.round(cx + Math.cos(t) * rx), y: Math.round(cy + Math.sin(t) * ry) });
  }
  for (let i = 1; i < points.length; i++) drawClippedLine(grid, mask, points[i - 1], points[i], width, 300, 5);
}

function drawRadialArterials(grid: Grid, mask: Grid, bounds: Bounds, center: Point, width: number): void {
  if (!bounds.has) return;
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.72;
  const angles = [0, Math.PI / 2, Math.PI / 5, -Math.PI / 5, Math.PI * 0.82, Math.PI * 1.18];
  for (const a of angles) {
    const p0 = { x: center.x - Math.cos(a) * extent, y: center.y - Math.sin(a) * extent };
    const p1 = { x: center.x + Math.cos(a) * extent, y: center.y + Math.sin(a) * extent };
    drawClippedLine(grid, mask, p0, p1, width, 300, 16);
  }
}

function drawDistrictGrid(
  grid: Grid,
  mask: Grid,
  center: RoadCenter,
  spacing: number,
  radius: number,
  rotation: number,
  width: number
): void {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const half = radius;
  const lineCount = Math.ceil((radius * 2) / spacing);
  const toWorld = (u: number, v: number): Point => ({
    x: Math.round(center.x + u * cos - v * sin),
    y: Math.round(center.y + u * sin + v * cos),
  });

  for (let i = -lineCount; i <= lineCount; i++) {
    const off = i * spacing;
    drawClippedLine(grid, mask, toWorld(-half, off), toWorld(half, off), width, 301, Math.max(4, Math.floor(spacing * 0.65)));
    drawClippedLine(grid, mask, toWorld(off, -half), toWorld(off, half), width, 301, Math.max(4, Math.floor(spacing * 0.65)));
  }
}

function drawMetroGrid(grid: Grid, mask: Grid, bounds: Bounds, center: Point, spacing: number, rotation: number, width: number): void {
  if (!bounds.has) return;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const extent = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.6;
  const toWorld = (u: number, v: number): Point => ({
    x: Math.round(center.x + u * cos - v * sin),
    y: Math.round(center.y + u * sin + v * cos),
  });
  const lineCount = Math.ceil(extent / spacing);
  for (let i = -lineCount; i <= lineCount; i++) {
    const off = i * spacing;
    drawClippedLine(grid, mask, toWorld(-extent, off), toWorld(extent, off), width, 301, Math.max(8, Math.floor(spacing * 0.9)));
    drawClippedLine(grid, mask, toWorld(off, -extent), toWorld(off, extent), width, 301, Math.max(8, Math.floor(spacing * 0.9)));
  }
}

export function gtaRoads(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.landGrid)) return { error: "landGrid is required" };
  if (!isGrid(input.countryGrid)) return { error: "countryGrid is required" };
  const landGrid = input.landGrid as Grid;
  const countryGrid = input.countryGrid as Grid;
  const heightMap = isGrid(input.heightMap) ? input.heightMap as Grid : null;
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const seed = resolveSeed(input.seed);
  const districtCount = clamp(int(input, "districtCount", 12), 2, 40);
  const localSpacing = clamp(int(input, "localSpacing", 34), 4, 80);
  const districtRadius = clamp(int(input, "districtRadius", 95), 12, 240);
  const coastInset = clamp(int(input, "coastInset", 10), 0, 60);
  const arterialWidth = clamp(int(input, "arterialWidth", 1), 1, 5);
  const streetWidth = clamp(int(input, "streetWidth", 1), 1, 3);
  const largestOnly = bool(input, "largestCountryOnly", false);

  const targetMask = buildTargetMask(landGrid, countryGrid, largestOnly);
  const coastDist = distanceFromEdge(targetMask);
  const mask = makeUrbanMask(targetMask, coastDist, heightMap, coastInset);
  const bounds = maskBounds(mask);
  const roadGrid = makeGrid(rows, cols, 0);
  const center = weightedCenter(mask, coastDist, heightMap);
  const centers = pickRoadCenters(mask, coastDist, districtCount, heightMap, seed);

  drawRingRoad(roadGrid, mask, centers, arterialWidth);
  drawRadialArterials(roadGrid, mask, bounds, center, arterialWidth);
  connectCenters(roadGrid, mask, centers, arterialWidth);
  drawMetroGrid(roadGrid, mask, bounds, center, localSpacing * 5.2, 0, streetWidth);
  centers.forEach((center, idx) => {
    const districtAngles = [0, Math.PI * 0.08, -Math.PI * 0.08, Math.PI * 0.18, -Math.PI * 0.18];
    const rotation = districtAngles[idx % districtAngles.length];
    const jitteredRadius = districtRadius * (0.72 + valueNoise(center.x * 0.05, center.y * 0.05, seed + 701) * 0.55);
    drawDistrictGrid(roadGrid, mask, center, localSpacing, jitteredRadius, rotation, streetWidth);
  });

  return {
    roadGrid,
    roadCenters: centers,
    outputGrid: roadGrid,
    outputNameList: ROAD_NAMES,
  };
}
