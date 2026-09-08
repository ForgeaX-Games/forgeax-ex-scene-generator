type Grid = number[][];

interface NameEntry {
  id: number;
  name: string;
  type?: string;
}

interface Point { x: number; y: number; }
interface HeapNode { idx: number; f: number; }
interface RoadComponent { cells: number[]; samples: Point[]; }

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

function maskedDisk(grid: Grid, mask: Grid | null, cx: number, cy: number, radius: number, value: number): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const r = Math.max(0, Math.round(radius));
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = Math.round(cx) + dx;
      const y = Math.round(cy) + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      if (mask && !mask[y]?.[x]) continue;
      grid[y][x] = value;
    }
  }
}

function drawClippedLine(grid: Grid, mask: Grid | null, a: Point, b: Point, radius: number, value: number, minRun = 5, maxGap = 0): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  let run: Point[] = [];
  let gap: Point[] = [];
  const flush = () => {
    const drawMask = maxGap > 0 ? null : mask;
    if (run.length >= minRun) for (const p of run) maskedDisk(grid, drawMask, p.x, p.y, radius, value);
    run = [];
    gap = [];
  };
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    const ok = x >= 0 && y >= 0 && x < cols && y < rows && (!mask || mask[y]?.[x] > 0);
    if (ok) {
      if (gap.length > 0 && gap.length <= maxGap) run.push(...gap);
      else if (gap.length > maxGap) flush();
      gap = [];
      if (run.length === 0 || run[run.length - 1].x !== x || run[run.length - 1].y !== y) run.push({ x, y });
    } else {
      gap.push({ x, y });
    }
  }
  flush();
}

function overlay(base: Grid, layer: Grid | null): Grid {
  const out = base.map(row => row.slice());
  if (!layer) return out;
  for (let y = 0; y < out.length; y++) {
    for (let x = 0; x < (out[0]?.length ?? 0); x++) {
      const v = layer[y]?.[x] ?? 0;
      if (v !== 0) out[y][x] = v;
    }
  }
  return out;
}

function rand01(x: number, y: number, seed: number): number {
  return hash2(Math.floor(x), Math.floor(y), seed);
}

function nearestMaskPoint(mask: Grid, point: Point): Point | null {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const sx = clamp(Math.round(point.x), 0, cols - 1);
  const sy = clamp(Math.round(point.y), 0, rows - 1);
  if (mask[sy]?.[sx]) return { x: sx, y: sy };
  const maxR = Math.max(rows, cols);
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = sx + dx;
        const y = sy + dy;
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        if (mask[y]?.[x]) return { x, y };
      }
    }
  }
  return null;
}

function terrainStepCost(x: number, y: number, mask: Grid, heightMap: Grid | null): number {
  const h = heightMap ? (heightMap[y]?.[x] ?? 0.55) : 0.55;
  const zone = mask[y]?.[x] ?? 0;
  const zoneBias = zone === 410 || zone === 411 ? 0.75 : zone === 412 ? 0.9 : zone === 414 ? 1.05 : 1.35;
  const highPenalty = Math.max(0, h - 0.72) * 6;
  const lowPenalty = Math.max(0, 0.48 - h) * 2;
  return zoneBias + highPenalty + lowPenalty;
}

function terrainPath(mask: Grid, heightMap: Grid | null, start: Point, goal: Point): Point[] {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const s = nearestMaskPoint(mask, start);
  const g0 = nearestMaskPoint(mask, goal);
  if (!s || !g0) return [start, goal];
  const startIdx = s.y * cols + s.x;
  const goalIdx = g0.y * cols + g0.x;
  const best = new Float64Array(rows * cols);
  const prev = new Int32Array(rows * cols);
  best.fill(Infinity);
  prev.fill(-1);
  best[startIdx] = 0;
  const heap = new MinHeap();
  heap.push({ idx: startIdx, f: 0 });
  while (heap.length > 0) {
    const cur = heap.pop();
    if (!cur) break;
    if (cur.idx === goalIdx) break;
    const x = cur.idx % cols;
    const y = Math.floor(cur.idx / cols);
    const heuristic = Math.hypot(g0.x - x, g0.y - y);
    if (cur.f > best[cur.idx] + heuristic + 1e-6) continue;
    for (const [dx, dy, step] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !mask[ny]?.[nx]) continue;
      const ni = ny * cols + nx;
      const cost = best[cur.idx] + step * terrainStepCost(nx, ny, mask, heightMap);
      if (cost >= best[ni]) continue;
      best[ni] = cost;
      prev[ni] = cur.idx;
      heap.push({ idx: ni, f: cost + Math.hypot(g0.x - nx, g0.y - ny) });
    }
  }
  if (prev[goalIdx] < 0) return [s, g0];
  const out: Point[] = [];
  for (let idx = goalIdx; idx >= 0; idx = prev[idx]) {
    out.push({ x: idx % cols, y: Math.floor(idx / cols) });
    if (idx === startIdx) break;
  }
  return out.reverse();
}

function drawPath(grid: Grid, mask: Grid | null, path: Point[], radius: number, value: number): void {
  for (const p of path) maskedDisk(grid, mask, p.x, p.y, radius, value);
}

function roadComponents(roadGrid: Grid): RoadComponent[] {
  const rows = roadGrid.length;
  const cols = roadGrid[0]?.length ?? 0;
  const seen = new Uint8Array(rows * cols);
  const components: RoadComponent[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const start = y * cols + x;
      if (seen[start] || (roadGrid[y]?.[x] ?? 0) < 300) continue;
      const queue = [start];
      const cells: number[] = [];
      seen[start] = 1;
      let head = 0;
      while (head < queue.length) {
        const idx = queue[head++];
        cells.push(idx);
        const cx = idx % cols;
        const cy = Math.floor(idx / cols);
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (seen[ni] || (roadGrid[ny]?.[nx] ?? 0) < 300) continue;
          seen[ni] = 1;
          queue.push(ni);
        }
      }
      const stride = Math.max(1, Math.floor(cells.length / 32));
      const samples = cells.filter((_, i) => i % stride === 0).slice(0, 48).map(idx => ({ x: idx % cols, y: Math.floor(idx / cols) }));
      components.push({ cells, samples });
    }
  }
  return components.sort((a, b) => b.cells.length - a.cells.length);
}

function nearestComponentPair(a: RoadComponent[], b: RoadComponent): [Point, Point] {
  let pa = a[0].samples[0];
  let pb = b.samples[0];
  let best = Infinity;
  for (const ca of a) {
    for (const sa of ca.samples) {
      for (const sb of b.samples) {
        const d = (sa.x - sb.x) ** 2 + (sa.y - sb.y) ** 2;
        if (d < best) {
          best = d;
          pa = sa;
          pb = sb;
        }
      }
    }
  }
  return [pa, pb];
}

function connectRoadComponents(roadGrid: Grid, travelMask: Grid, heightMap: Grid | null, radius: number, value: number, maxBridgeDistance: number): Grid {
  const out = roadGrid.map(row => row.slice());
  const components = roadComponents(out);
  if (components.length <= 1) return out;
  const connected: RoadComponent[] = [components[0]];
  for (let i = 1; i < components.length; i++) {
    const [a, b] = nearestComponentPair(connected, components[i]);
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (dist <= maxBridgeDistance) {
      drawClippedLine(out, null, a, b, radius, value, 2, 0);
    } else {
      drawPath(out, travelMask, terrainPath(travelMask, heightMap, a, b), radius, value);
    }
    connected.push(components[i]);
  }
  return out;
}

const NAMES: NameEntry[] = [
  { id: 300, name: "GTA 主干路", type: "tile" },
  { id: 301, name: "GTA 辅路", type: "tile" },
  { id: 302, name: "GTA 小路", type: "tile" },
];

function isDenseZone(v: number): boolean {
  return v === 410 || v === 411 || v === 414;
}

export function gtaLocalRoads(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.zoneGrid)) return { error: "zoneGrid is required" };
  if (!isGrid(input.roadGrid)) return { error: "roadGrid is required" };
  const zoneGrid = input.zoneGrid as Grid;
  const baseRoadGrid = input.roadGrid as Grid;
  const heightMap = isGrid(input.heightMap) ? input.heightMap as Grid : null;
  const rows = zoneGrid.length;
  const cols = zoneGrid[0]?.length ?? 0;
  const seed = resolveSeed(input.seed);
  const spacing = clamp(int(input, "spacing", 28), 10, 80);
  const coverage = clamp(num(input, "coverage", 0.52), 0, 1);
  const connectRadius = clamp(int(input, "connectRadius", 120), 0, 400);
  const localRoadGrid = makeGrid(rows, cols, 0);
  const mask = zoneGrid.map(row => row.map(v => isDenseZone(v) ? 1 : 0));
  const travelMask = zoneGrid.map(row => row.map(v => v ? v : 0));

  const block = spacing * 3;
  for (let y0 = 0; y0 < rows; y0 += block) {
    for (let x0 = 0; x0 < cols; x0 += block) {
      if (rand01(x0, y0, seed) > coverage) continue;
      const rot = rand01(x0 + 17, y0 + 31, seed) > 0.5 ? 0 : Math.PI * 0.5;
      const lines = 2 + Math.floor(rand01(x0 + 41, y0 + 13, seed) * 3);
      for (let i = 1; i <= lines; i++) {
        const off = (i / (lines + 1)) * block;
        const a: Point = rot === 0 ? { x: x0, y: y0 + off } : { x: x0 + off, y: y0 };
        const b: Point = rot === 0 ? { x: x0 + block, y: y0 + off } : { x: x0 + off, y: y0 + block };
        drawClippedLine(localRoadGrid, mask, a, b, 1, 302, Math.max(8, Math.floor(spacing * 0.6)), 0);
      }
    }
  }

  const roadGrid = connectRoadComponents(overlay(baseRoadGrid, localRoadGrid), travelMask, heightMap, 1, 301, connectRadius);
  return { roadGrid, localRoadGrid, outputGrid: roadGrid, outputNameList: NAMES };
}
