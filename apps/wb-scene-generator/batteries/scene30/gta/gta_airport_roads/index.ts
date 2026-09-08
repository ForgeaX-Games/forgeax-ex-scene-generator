type Grid = number[][];

interface Point { x: number; y: number; }
interface Site {
  centerX: number;
  centerY: number;
  angle: number;
  length: number;
  width: number;
}
interface HeapNode { idx: number; f: number; }

const RUNWAY = 304;
const AIRPORT_ENTRANCE = 305;
const DIR8: Array<[number, number, number]> = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2],
];

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
      const p = (i - 1) >> 1;
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

function isGrid(value: unknown): value is Grid {
  return Array.isArray(value)
    && value.length > 0
    && Array.isArray(value[0])
    && ((value[0] as unknown[]).length === 0 || typeof (value[0] as unknown[])[0] === "number");
}

function makeGrid(rows: number, cols: number, fill = 0): Grid {
  return Array.from({ length: rows }, () => new Array(cols).fill(fill));
}

function int(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  return Math.round(typeof value === "number" && Number.isFinite(value) ? value : fallback);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isSite(value: unknown): value is Site {
  if (!value || typeof value !== "object") return false;
  const site = value as Record<string, unknown>;
  return ["centerX", "centerY", "angle", "length", "width"].every(key => typeof site[key] === "number" && Number.isFinite(site[key] as number));
}

function fallbackSite(mask: Grid): Site {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  let sx = 0;
  let sy = 0;
  let count = 0;
  let minX = cols;
  let maxX = 0;
  let minY = rows;
  let maxY = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y]?.[x]) continue;
      sx += x;
      sy += y;
      count++;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const w = Math.max(1, maxX - minX + 1);
  const h = Math.max(1, maxY - minY + 1);
  return {
    centerX: count ? sx / count : cols / 2,
    centerY: count ? sy / count : rows / 2,
    angle: w >= h ? 0 : Math.PI / 2,
    length: Math.max(w, h),
    width: Math.min(w, h),
  };
}

function maskedDisk(grid: Grid, mask: Grid | null, cx: number, cy: number, radius: number, value: number): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const r = Math.max(0, Math.round(radius));
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = Math.round(cx) + dx;
      const y = Math.round(cy) + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      if (mask && !mask[y]?.[x]) continue;
      grid[y][x] = value;
    }
  }
}

function bufferedMask(source: Grid, radius: number): Grid {
  const rows = source.length;
  const cols = source[0]?.length ?? 0;
  const out = makeGrid(rows, cols, 0);
  const r = Math.max(0, Math.round(radius));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!source[y]?.[x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) out[ny][nx] = 1;
        }
      }
    }
  }
  return out;
}

function subtractMask(mask: Grid, blocked: Grid): Grid {
  return mask.map((row, y) => row.map((v, x) => (v && !blocked[y]?.[x] ? 1 : 0)));
}

function drawLine(grid: Grid, mask: Grid | null, a: Point, b: Point, radius: number, value: number): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    maskedDisk(grid, mask, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius, value);
  }
}

function drawRotatedRect(grid: Grid, mask: Grid | null, center: Point, length: number, width: number, angle: number, value: number): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const halfL = length / 2;
  const halfW = width / 2;
  const r = Math.ceil(Math.hypot(halfL, halfW));
  const minX = Math.max(0, Math.floor(center.x - r));
  const maxX = Math.min(cols - 1, Math.ceil(center.x + r));
  const minY = Math.max(0, Math.floor(center.y - r));
  const maxY = Math.min(rows - 1, Math.ceil(center.y + r));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (mask && !mask[y]?.[x]) continue;
      const dx = x - center.x;
      const dy = y - center.y;
      const u = dx * ca + dy * sa;
      const v = -dx * sa + dy * ca;
      if (Math.abs(u) <= halfL && Math.abs(v) <= halfW) grid[y][x] = value;
    }
  }
}

function airportBoundary(mask: Grid): Point[] {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const out: Point[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y]?.[x]) continue;
      if (DIR8.some(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx < 0 || ny < 0 || nx >= cols || ny >= rows || !mask[ny]?.[nx];
      })) out.push({ x, y });
    }
  }
  return out;
}

function cityRoadCells(roadGrid: Grid, airportMask: Grid): Point[] {
  const rows = roadGrid.length;
  const cols = roadGrid[0]?.length ?? 0;
  const out: Point[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = roadGrid[y]?.[x] ?? 0;
      if ((v === 300 || v === 301 || v === 302) && !airportMask[y]?.[x]) out.push({ x, y });
    }
  }
  return out;
}

function nearestPair(a: Point[], b: Point[]): [Point, Point] | null {
  if (a.length === 0 || b.length === 0) return null;
  const stepA = Math.max(1, Math.floor(a.length / 320));
  const stepB = Math.max(1, Math.floor(b.length / 420));
  let bestA = a[0];
  let bestB = b[0];
  let best = Infinity;
  for (let i = 0; i < a.length; i += stepA) {
    const pa = a[i];
    for (let j = 0; j < b.length; j += stepB) {
      const pb = b[j];
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      if (d >= best) continue;
      best = d;
      bestA = pa;
      bestB = pb;
    }
  }
  return [bestA, bestB];
}

function routeMask(landGrid: Grid | null, airportMask: Grid, blocked: Grid | null = null): Grid {
  const rows = airportMask.length;
  const cols = airportMask[0]?.length ?? 0;
  const out = makeGrid(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (blocked && blocked[y]?.[x]) continue;
      out[y][x] = (landGrid ? landGrid[y]?.[x] : 1) || airportMask[y]?.[x] ? 1 : 0;
    }
  }
  return out;
}

function stepCost(x: number, y: number, px: number, py: number, heightMap: Grid | null, airportMask: Grid, cityRoadGrid: Grid): number {
  const h = heightMap ? (heightMap[y]?.[x] ?? 0.55) : 0.55;
  const ph = heightMap ? (heightMap[py]?.[px] ?? h) : h;
  const road = cityRoadGrid[y]?.[x] ? 0.45 : 1;
  const airport = airportMask[y]?.[x] ? 0.72 : 1;
  return road * airport + Math.abs(h - ph) * 12 + Math.max(0, h - 0.78) * 5;
}

function terrainPath(mask: Grid, airportMask: Grid, cityRoadGrid: Grid, heightMap: Grid | null, start: Point, goal: Point): Point[] {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const sx = clamp(Math.round(start.x), 0, cols - 1);
  const sy = clamp(Math.round(start.y), 0, rows - 1);
  const gx = clamp(Math.round(goal.x), 0, cols - 1);
  const gy = clamp(Math.round(goal.y), 0, rows - 1);
  if (!mask[sy]?.[sx] || !mask[gy]?.[gx]) return [start, goal];
  const startIdx = sy * cols + sx;
  const goalIdx = gy * cols + gx;
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
    if (cur.f > best[cur.idx] + Math.hypot(gx - x, gy - y) + 1e-6) continue;
    for (const [dx, dy, step] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !mask[ny]?.[nx]) continue;
      const ni = ny * cols + nx;
      const cost = best[cur.idx] + step * stepCost(nx, ny, x, y, heightMap, airportMask, cityRoadGrid);
      if (cost >= best[ni]) continue;
      best[ni] = cost;
      prev[ni] = cur.idx;
      heap.push({ idx: ni, f: cost + Math.hypot(gx - nx, gy - ny) });
    }
  }

  if (prev[goalIdx] < 0) return [start, goal];
  const out: Point[] = [];
  for (let idx = goalIdx; idx >= 0; idx = prev[idx]) {
    out.push({ x: idx % cols, y: Math.floor(idx / cols) });
    if (idx === startIdx) break;
  }
  return out.reverse();
}

function drawPath(grid: Grid, mask: Grid | null, path: Point[], radius: number, value: number): void {
  for (let i = 1; i < path.length; i++) drawLine(grid, mask, path[i - 1], path[i], radius, value);
}

function overlay(base: Grid, layer: Grid): void {
  for (let y = 0; y < base.length; y++) {
    for (let x = 0; x < (base[0]?.length ?? 0); x++) {
      const v = layer[y]?.[x] ?? 0;
      if (v) base[y][x] = v;
    }
  }
}

export function gtaAirportRoads(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.airportMask)) return { error: "airportMask is required" };
  const airportMask = input.airportMask as Grid;
  const cityRoadGrid = isGrid(input.cityRoadGrid) ? input.cityRoadGrid as Grid : makeGrid(airportMask.length, airportMask[0]?.length ?? 0);
  const landGrid = isGrid(input.landGrid) ? input.landGrid as Grid : null;
  const heightMap = isGrid(input.heightMap) ? input.heightMap as Grid : null;
  const site = isSite(input.airportSite) ? input.airportSite as Site : fallbackSite(airportMask);
  const rows = airportMask.length;
  const cols = airportMask[0]?.length ?? 0;
  const runwayWidth = clamp(int(input, "runwayWidth", 10), 3, 32);
  const taxiwayWidth = clamp(int(input, "taxiwayWidth", 4), 1, 16);
  const entranceWidth = clamp(int(input, "entranceWidth", 2), 1, 10);

  const runwayGrid = makeGrid(rows, cols, 0);
  const serviceRoadGrid = makeGrid(rows, cols, 0);
  const entranceRoadGrid = makeGrid(rows, cols, 0);
  const runwayLength = Math.max(22, site.length * 0.68);
  const runwayCenter = { x: site.centerX, y: site.centerY };
  drawRotatedRect(runwayGrid, airportMask, runwayCenter, runwayLength, runwayWidth, site.angle, RUNWAY);
  const runwayNoGo = bufferedMask(runwayGrid, Math.max(2, taxiwayWidth + entranceWidth));
  const airportServiceMask = subtractMask(airportMask, runwayNoGo);

  const nx = -Math.sin(site.angle);
  const ny = Math.cos(site.angle);
  const offset = Math.min(site.width * 0.42, runwayWidth * 2.8 + taxiwayWidth);
  const taxiCenter = { x: site.centerX + nx * offset, y: site.centerY + ny * offset };
  drawRotatedRect(serviceRoadGrid, airportServiceMask, taxiCenter, runwayLength * 0.74, taxiwayWidth, site.angle, AIRPORT_ENTRANCE);

  const pair = nearestPair(airportBoundary(airportMask), cityRoadCells(cityRoadGrid, airportMask));
  if (pair) {
    const [airportGate, roadTarget] = pair;
    const outsideRouteMask = routeMask(landGrid, airportMask, runwayNoGo);
    const path = terrainPath(outsideRouteMask, airportMask, cityRoadGrid, heightMap, airportGate, roadTarget);
    drawPath(entranceRoadGrid, outsideRouteMask, path, entranceWidth, AIRPORT_ENTRANCE);
    const apronPath = terrainPath(airportServiceMask, airportMask, cityRoadGrid, heightMap, airportGate, taxiCenter);
    drawPath(serviceRoadGrid, airportServiceMask, apronPath, taxiwayWidth, AIRPORT_ENTRANCE);
  }

  const roadGrid = cityRoadGrid.map(row => row.slice());
  overlay(roadGrid, entranceRoadGrid);
  overlay(roadGrid, serviceRoadGrid);
  overlay(roadGrid, runwayGrid);
  const outputGrid = makeGrid(rows, cols, 0);
  overlay(outputGrid, entranceRoadGrid);
  overlay(outputGrid, serviceRoadGrid);
  overlay(outputGrid, runwayGrid);

  return {
    roadGrid,
    runwayGrid,
    entranceRoadGrid,
    serviceRoadGrid,
    outputGrid,
    outputNameList: [
      { id: RUNWAY, name: "机场跑道", type: "tile" },
      { id: AIRPORT_ENTRANCE, name: "机场入口道路", type: "tile" },
    ],
  };
}
