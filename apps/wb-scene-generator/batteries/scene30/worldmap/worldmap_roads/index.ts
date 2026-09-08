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

interface Point { x: number; y: number; }
interface HeapNode { idx: number; f: number; }

class MinHeap {
  private data: HeapNode[] = [];
  get length(): number { return this.data.length; }
  push(node: HeapNode): void {
    this.data.push(node);
    this.up(this.data.length - 1);
  }
  pop(): HeapNode | undefined {
    const first = this.data[0];
    const last = this.data.pop();
    if (!last || this.data.length === 0) return first;
    this.data[0] = last;
    this.down(0);
    return first;
  }
  private up(i: number): void {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.data[p].f <= this.data[i].f) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }
  private down(i: number): void {
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let b = i;
      if (l < this.data.length && this.data[l].f < this.data[b].f) b = l;
      if (r < this.data.length && this.data[r].f < this.data[b].f) b = r;
      if (b === i) break;
      [this.data[b], this.data[i]] = [this.data[i], this.data[b]];
      i = b;
    }
  }
}

const DIR8: Array<[number, number, number]> = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2],
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

function drawDisk(grid: Grid, cx: number, cy: number, radius: number, value: number): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const r = Math.max(0, Math.round(radius));
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = Math.round(cx) + dx;
      const y = Math.round(cy) + dy;
      if (x >= 0 && y >= 0 && x < cols && y < rows) grid[y][x] = value;
    }
  }
}

function drawLine(grid: Grid, ax: number, ay: number, bx: number, by: number, radius: number, value: number): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    drawDisk(grid, ax + (bx - ax) * t, ay + (by - ay) * t, radius, value);
  }
}

const NAMES: NameEntry[] = [
  { id: 300, name: "主道路", type: "tile" },
  { id: 301, name: "城市道路", type: "tile" },
  { id: 303, name: "海底隧道", type: "tile" },
];

function isCityPoint(value: unknown): value is CityPoint {
  const p = value as Partial<CityPoint>;
  return typeof p?.x === "number" && typeof p?.y === "number" && typeof p?.id === "number";
}

function chaikin(points: Point[], iterations: number): Point[] {
  let out = points;
  for (let it = 0; it < iterations; it++) {
    if (out.length < 3) break;
    const next: Point[] = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i];
      const b = out[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

function routeCost(x: number, y: number, fromX: number, fromY: number, landGrid: Grid, heightMap: Grid | null, seed: number): number {
  const land = landGrid[y]?.[x] ? 1 : 0;
  const h = heightMap ? (heightMap[y]?.[x] ?? 0.45) : 0.55;
  const prevH = heightMap ? (heightMap[fromY]?.[fromX] ?? h) : h;
  const slope = Math.abs(h - prevH);
  const plain = Math.abs(h - 0.57);
  const highPenalty = Math.max(0, h - 0.72) * 8;
  const slopePenalty = slope * 14;
  const noise = valueNoise(x * 0.018, y * 0.018, seed) * 0.35;
  return (land ? 1.0 : 16.0) + plain * 1.8 + highPenalty + slopePenalty + noise;
}

function terrainPath(a: CityPoint, b: CityPoint, landGrid: Grid, heightMap: Grid | null, seed: number): Point[] {
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const start = Math.round(a.y) * cols + Math.round(a.x);
  const goal = Math.round(b.y) * cols + Math.round(b.x);
  const best = new Float64Array(rows * cols);
  const prev = new Int32Array(rows * cols);
  best.fill(Infinity);
  prev.fill(-1);
  best[start] = 0;
  const heap = new MinHeap();
  heap.push({ idx: start, f: 0 });
  const gx = Math.round(b.x);
  const gy = Math.round(b.y);
  while (heap.length > 0) {
    const cur = heap.pop();
    if (!cur) break;
    if (cur.idx === goal) break;
    const x = cur.idx % cols;
    const y = Math.floor(cur.idx / cols);
    if (cur.f > best[cur.idx] + Math.hypot(gx - x, gy - y) + 1e-6) continue;
    for (const [dx, dy, step] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      const cost = best[cur.idx] + step * routeCost(nx, ny, x, y, landGrid, heightMap, seed);
      if (cost >= best[ni]) continue;
      best[ni] = cost;
      prev[ni] = cur.idx;
      heap.push({ idx: ni, f: cost + Math.hypot(gx - nx, gy - ny) });
    }
  }
  if (prev[goal] < 0) return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
  const out: Point[] = [];
  for (let idx = goal; idx >= 0; idx = prev[idx]) {
    out.push({ x: idx % cols, y: Math.floor(idx / cols) });
    if (idx === start) break;
  }
  return out.reverse();
}

function simplifyPath(path: Point[], spacing: number): Point[] {
  if (path.length <= 2) return path;
  const out: Point[] = [path[0]];
  let last = path[0];
  for (let i = spacing; i < path.length - 1; i += spacing) {
    const p = path[i];
    if (Math.hypot(p.x - last.x, p.y - last.y) < spacing * 0.6) continue;
    out.push(p);
    last = p;
  }
  out.push(path[path.length - 1]);
  return out;
}

function curvedPath(a: CityPoint, b: CityPoint, landGrid: Grid, heightMap: Grid | null, seed: number): Point[] {
  const raw = terrainPath(a, b, landGrid, heightMap, seed);
  const spacing = Math.max(5, Math.round(Math.hypot(a.x - b.x, a.y - b.y) / 18));
  const smoothed = chaikin(simplifyPath(raw, spacing), 2);
  const path: Point[] = [];
  for (const p of smoothed) {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (path.length === 0 || path[path.length - 1].x !== x || path[path.length - 1].y !== y) path.push({ x, y });
  }
  return path;
}

function oceanFrac(path: Point[], landGrid: Grid): number {
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  let ocean = 0;
  for (const p of path) {
    if (p.x < 0 || p.y < 0 || p.x >= cols || p.y >= rows || !landGrid[p.y][p.x]) ocean++;
  }
  return ocean / Math.max(1, path.length);
}

function straightProbePath(a: CityPoint, b: CityPoint): Point[] {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  const path: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push({ x: Math.round(a.x + (b.x - a.x) * t), y: Math.round(a.y + (b.y - a.y) * t) });
  }
  return path;
}

function drawRoadSample(roadGrid: Grid, tunnelGrid: Grid, landGrid: Grid, x: number, y: number, radius: number, roadValue: number): void {
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  if (x < 0 || y < 0 || x >= cols || y >= rows) return;
  if (landGrid[y]?.[x]) drawDisk(roadGrid, x, y, radius, roadValue);
  else drawDisk(tunnelGrid, x, y, radius, 303);
}

function drawRoadSegment(
  roadGrid: Grid,
  tunnelGrid: Grid,
  landGrid: Grid,
  a: { x: number; y: number },
  b: { x: number; y: number },
  radius: number,
  roadValue: number
): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    drawRoadSample(
      roadGrid,
      tunnelGrid,
      landGrid,
      Math.round(a.x + (b.x - a.x) * t),
      Math.round(a.y + (b.y - a.y) * t),
      radius,
      roadValue
    );
  }
}

function drawRoadPath(roadGrid: Grid, tunnelGrid: Grid, landGrid: Grid, path: Point[], radius: number, roadValue: number): void {
  for (let i = 1; i < path.length; i++) {
    drawRoadSegment(roadGrid, tunnelGrid, landGrid, path[i - 1], path[i], radius, roadValue);
  }
}

function drawLocalStreets(roadGrid: Grid, landGrid: Grid, city: CityPoint, size: number, seed: number): void {
  if (size <= 0) return;
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const angle = valueNoise(city.x * 0.05, city.y * 0.05, seed + city.id * 17) * Math.PI;
  const dirs = [angle, angle + Math.PI * 0.5];
  for (const dir of dirs) {
    const dx = Math.cos(dir);
    const dy = Math.sin(dir);
    for (let s = -size; s <= size; s++) {
      const x = Math.round(city.x + dx * s);
      const y = Math.round(city.y + dy * s);
      if (x < 0 || y < 0 || x >= cols || y >= rows || !landGrid[y]?.[x]) continue;
      roadGrid[y][x] = 301;
    }
  }
}

export function worldmapRoads(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.landGrid)) return { error: "landGrid is required" };
  const landGrid = input.landGrid as Grid;
  const heightMap = isGrid(input.heightMap) ? input.heightMap as Grid : null;
  const rows = landGrid.length;
  const cols = landGrid[0]?.length ?? 0;
  const cityPoints = Array.isArray(input.cityPoints) ? input.cityPoints.filter(isCityPoint) : [];
  const roadGrid = makeGrid(rows, cols, 0);
  const tunnelGrid = makeGrid(rows, cols, 0);
  if (cityPoints.length === 0) return { roadGrid, tunnelGrid, outputGrid: roadGrid, outputNameList: NAMES };

  const seed = resolveSeed(input.seed);
  const roadWidth = clamp(int(input, "roadWidth", 0), 0, 5);
  const maxOcean = clamp(num(input, "maxOcean", 0.45), 0, 1);
  const extraEdges = clamp(int(input, "extraEdges", 5), 0, 60);
  const localStreetSize = clamp(int(input, "localStreetSize", 0), 0, 10);

  const edges: Array<{ a: number; b: number; d: number; ocean: number }> = [];
  for (let i = 0; i < cityPoints.length; i++) {
    for (let j = i + 1; j < cityPoints.length; j++) {
      const d = Math.hypot(cityPoints[i].x - cityPoints[j].x, cityPoints[i].y - cityPoints[j].y);
      const path = straightProbePath(cityPoints[i], cityPoints[j]);
      const ocean = oceanFrac(path, landGrid);
      edges.push({ a: i, b: j, d: d * (1 + ocean * 2.2), ocean });
    }
  }
  edges.sort((a, b) => a.d - b.d);

  const parent = cityPoints.map((_, i) => i);
  const find = (x: number): number => parent[x] === x ? x : (parent[x] = find(parent[x]));
  const used = new Set<string>();
  const add = (e: { a: number; b: number }) => {
    const key = e.a < e.b ? `${e.a}-${e.b}` : `${e.b}-${e.a}`;
    if (used.has(key)) return;
    used.add(key);
    const path = curvedPath(cityPoints[e.a], cityPoints[e.b], landGrid, heightMap, seed + e.a * 97 + e.b * 131);
    drawRoadPath(roadGrid, tunnelGrid, landGrid, path, roadWidth, 300);
  };

  for (const e of edges) {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) {
      parent[ra] = rb;
      add(e);
    }
  }
  for (const e of edges.filter(edge => edge.ocean <= maxOcean).slice(0, extraEdges)) add(e);

  if (localStreetSize > 0) {
    for (const city of cityPoints) {
      drawLocalStreets(roadGrid, landGrid, city, localStreetSize, seed);
    }
  }

  const outputGrid = roadGrid.map((row, y) => row.map((v, x) => v || tunnelGrid[y][x]));
  return { roadGrid, tunnelGrid, outputGrid, outputNameList: NAMES };
}
