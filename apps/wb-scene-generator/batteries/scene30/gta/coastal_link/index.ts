type Grid = number[][];

interface NameEntry { id: number; name: string; type?: string; }
interface Point { x: number; y: number; }
interface HeapNode { idx: number; f: number; }

const COASTAL_ROAD = 302;

const DIR8: Array<[number, number, number]> = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2],
];
const N8: Array<[number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1],
];

class MinHeap {
  private data: HeapNode[] = [];
  get length(): number { return this.data.length; }
  push(node: HeapNode): void { this.data.push(node); this.up(this.data.length - 1); }
  pop(): HeapNode | undefined {
    const first = this.data[0]; const last = this.data.pop();
    if (!last || this.data.length === 0) return first;
    this.data[0] = last; this.down(0); return first;
  }
  private up(i: number): void {
    while (i > 0) { const p = (i - 1) >> 1; if (this.data[p].f <= this.data[i].f) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]]; i = p; }
  }
  private down(i: number): void {
    for (;;) { const l = i * 2 + 1, r = l + 1; let b = i;
      if (l < this.data.length && this.data[l].f < this.data[b].f) b = l;
      if (r < this.data.length && this.data[r].f < this.data[b].f) b = r;
      if (b === i) break; [this.data[b], this.data[i]] = [this.data[i], this.data[b]]; i = b; }
  }
}

function isGrid(value: unknown): value is Grid {
  return Array.isArray(value) && value.length > 0 && Array.isArray(value[0])
    && ((value[0] as unknown[]).length === 0 || typeof (value[0] as unknown[])[0] === "number");
}
function makeGrid(rows: number, cols: number, fill = 0): Grid {
  return Array.from({ length: rows }, () => new Array(cols).fill(fill));
}
function num(input: Record<string, unknown>, key: string, fallback: number): number {
  const v = input[key]; return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function int(input: Record<string, unknown>, key: string, fallback: number): number {
  return Math.round(num(input, key, fallback));
}
function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }
function resolveSeed(seed: unknown): number {
  const raw = typeof seed === "number" && Number.isFinite(seed) ? seed : 0;
  return raw === 0 ? 123456789 : raw >>> 0;
}
function hash2(x: number, y: number, seed: number): number {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function binarize(grid: Grid): Grid { return grid.map(row => row.map(v => (v ? 1 : 0))); }

function dilateClipped(mask: Grid, radius: number, land: Grid): Grid {
  const rows = mask.length, cols = mask[0]?.length ?? 0;
  if (radius <= 0) return mask.map(r => r.slice());
  const out = makeGrid(rows, cols, 0); const r2 = radius * radius;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!mask[y][x]) continue;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && land[ny]?.[nx]) out[ny][nx] = 1;
    }
  }
  return out;
}

function componentCells(grid: Grid): Point[][] {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const seen = new Uint8Array(rows * cols); const out: Point[][] = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const start = y * cols + x;
    if (seen[start] || !grid[y]?.[x]) continue;
    const queue = [start]; const cells: Point[] = []; seen[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const idx = queue[head]; const cx = idx % cols, cy = Math.floor(idx / cols);
      cells.push({ x: cx, y: cy });
      for (const [dx, dy] of N8) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (seen[ni] || !grid[ny]?.[nx]) continue;
        seen[ni] = 1; queue.push(ni);
      }
    }
    out.push(cells);
  }
  return out.sort((a, b) => b.length - a.length);
}
function filterIslands(land: Grid, minArea: number): Grid {
  const rows = land.length, cols = land[0]?.length ?? 0;
  const comps = componentCells(land); const out = makeGrid(rows, cols, 0);
  for (let i = 0; i < comps.length; i++) {
    if (i === 0 || comps[i].length >= minArea) for (const p of comps[i]) out[p.y][p.x] = 1;
  }
  return out;
}
function nearestPair(a: Point[], b: Point[]): { a: Point; b: Point; d: number } {
  let bestA = a[0], bestB = b[0], best = Infinity;
  const sa = Math.max(1, Math.floor(a.length / 200));
  const sb = Math.max(1, Math.floor(b.length / 200));
  for (let i = 0; i < a.length; i += sa) for (let j = 0; j < b.length; j += sb) {
    const d = Math.hypot(a[i].x - b[j].x, a[i].y - b[j].y);
    if (d < best) { best = d; bestA = a[i]; bestB = b[j]; }
  }
  return { a: bestA, b: bestB, d: best };
}
function nearestMaskPoint(mask: Grid, point: Point): Point | null {
  const rows = mask.length, cols = mask[0]?.length ?? 0;
  const sx = clamp(Math.round(point.x), 0, cols - 1);
  const sy = clamp(Math.round(point.y), 0, rows - 1);
  if (mask[sy]?.[sx]) return { x: sx, y: sy };
  for (let r = 1; r < Math.max(rows, cols); r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
      const x = sx + dx, y = sy + dy;
      if (x >= 0 && y >= 0 && x < cols && y < rows && mask[y]?.[x]) return { x, y };
    }
  }
  return null;
}
function shortestPath(routeMask: Grid, start: Point, goal: Point): Point[] {
  const rows = routeMask.length, cols = routeMask[0]?.length ?? 0;
  const s = nearestMaskPoint(routeMask, start);
  const g = nearestMaskPoint(routeMask, goal);
  if (!s || !g) return [];
  const startIdx = s.y * cols + s.x, goalIdx = g.y * cols + g.x;
  const best = new Float64Array(rows * cols).fill(Infinity);
  const prev = new Int32Array(rows * cols).fill(-1);
  best[startIdx] = 0;
  const heap = new MinHeap();
  heap.push({ idx: startIdx, f: Math.hypot(g.x - s.x, g.y - s.y) });
  while (heap.length > 0) {
    const cur = heap.pop(); if (!cur) break;
    if (cur.idx === goalIdx) break;
    const x = cur.idx % cols, y = Math.floor(cur.idx / cols);
    if (cur.f > best[cur.idx] + Math.hypot(g.x - x, g.y - y) + 1e-6) continue;
    for (const [dx, dy, step] of DIR8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !routeMask[ny]?.[nx]) continue;
      const ni = ny * cols + nx; const cost = best[cur.idx] + step;
      if (cost >= best[ni]) continue;
      best[ni] = cost; prev[ni] = cur.idx;
      heap.push({ idx: ni, f: cost + Math.hypot(g.x - nx, g.y - ny) });
    }
  }
  if (prev[goalIdx] < 0 && goalIdx !== startIdx) return [];
  const out: Point[] = [];
  for (let idx = goalIdx; idx >= 0; idx = prev[idx]) {
    out.push({ x: idx % cols, y: Math.floor(idx / cols) });
    if (idx === startIdx) break;
  }
  return out.reverse();
}
function stampSkelPoint(skel: Grid, land: Grid, x: number, y: number): void {
  const rows = skel.length, cols = skel[0]?.length ?? 0;
  const ix = Math.round(x), iy = Math.round(y);
  if (ix >= 0 && iy >= 0 && ix < cols && iy < rows && land[iy]?.[ix]) skel[iy][ix] = 1;
}
function stampSkelLine(skel: Grid, land: Grid, a: Point, b: Point): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    stampSkelPoint(skel, land, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
  }
}
function stampSkelPath(skel: Grid, land: Grid, path: Point[]): void {
  for (let i = 1; i < path.length; i++) stampSkelLine(skel, land, path[i - 1], path[i]);
}

// ── Moore 边界追踪：把任意宽度/含分叉的沿海 ribbon 排成连续有序折线 ───────
// coastal_roads 的区域边界天然是 2px 宽，且噪声扰动会让其局部形成 ladder/网状
// 结构（大量度 3/4 节点），用骨架细化 + 图追踪会脱轨破碎。改用 Moore 邻域轮廓
// 追踪：从分量左上角像素出发，顺时针沿 ribbon 外轮廓走一圈，无视内部宽度与分叉，
// 一次性得到一条沿海岸的连续有序回路（Jacob 终止判据闭合）。
const CW8: Array<[number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
function cwIndex(dx: number, dy: number): number {
  for (let i = 0; i < 8; i++) if (CW8[i][0] === dx && CW8[i][1] === dy) return i;
  return -1;
}
function mooreBoundary(cellSet: Set<number>, cols: number, startId: number): Point[] {
  const filled = (x: number, y: number): boolean => cellSet.has(y * cols + x);
  const sx = startId % cols, sy = (startId / cols) | 0;
  let p: Point = { x: sx, y: sy };
  let bt: Point = { x: sx - 1, y: sy }; // 进入起点的背景像素（西侧，扫描序保证为空）
  const boundary: Point[] = [{ x: sx, y: sy }];
  let firstP: Point | null = null, firstC: Point | null = null;
  const limit = cellSet.size * 8 + 32;
  for (let guard = 0; guard < limit; guard++) {
    const bdi = cwIndex(bt.x - p.x, bt.y - p.y);
    if (bdi < 0) break;
    let c: Point | null = null, nb: Point | null = null;
    for (let k = 1; k <= 8; k++) {
      const i = (bdi + k) % 8;
      const cx = p.x + CW8[i][0], cy = p.y + CW8[i][1];
      if (filled(cx, cy)) {
        c = { x: cx, y: cy };
        const pi = (i - 1 + 8) % 8;
        nb = { x: p.x + CW8[pi][0], y: p.y + CW8[pi][1] };
        break;
      }
    }
    if (!c || !nb) break; // 孤立像素
    if (firstP === null) { firstP = p; firstC = c; }
    else if (p.x === firstP.x && p.y === firstP.y && c.x === firstC!.x && c.y === firstC!.y) break;
    boundary.push(c);
    bt = nb; p = c;
  }
  return boundary;
}
function orderComponent(cells: Point[], cols: number): Point[] {
  if (cells.length === 0) return [];
  const set = new Set(cells.map(p => p.y * cols + p.x));
  let startId = cells[0].y * cols + cells[0].x;
  for (const p of cells) { const id = p.y * cols + p.x; if (id < startId) startId = id; }
  return mooreBoundary(set, cols, startId);
}

const NAMES: NameEntry[] = [{ id: COASTAL_ROAD, name: "沿海接驳路", type: "tile" }];

export function coastalLink(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.coastalRoadGrid)) return { error: "coastalRoadGrid is required" };
  if (!isGrid(input.mainRoadGrid)) return { error: "mainRoadGrid is required" };
  const coastalRoadGrid = input.coastalRoadGrid as Grid;
  const mainRoadGrid = input.mainRoadGrid as Grid;
  const rows = mainRoadGrid.length, cols = mainRoadGrid[0]?.length ?? 0;

  const seed = resolveSeed(input.seed);
  const keepRatio = clamp(num(input, "keepRatio", 0.7), 0.05, 1);
  const segLen = clamp(int(input, "segLen", 120), 16, 600);
  const connectDist = clamp(int(input, "connectDist", 70), 0, 200);
  const connectSpacing = clamp(int(input, "connectSpacing", 90), 16, 400);
  const minIslandArea = clamp(int(input, "minIslandArea", 1200), 0, 20000);
  const roadWidth = clamp(int(input, "roadWidth", 1), 1, 5);
  const drawRadius = Math.floor((roadWidth - 1) / 2);

  const rawLand = isGrid(input.landGrid) ? binarize(input.landGrid as Grid) : makeGrid(rows, cols, 1);
  const land = filterIslands(rawLand, minIslandArea);

  const mainBin = binarize(mainRoadGrid);
  const mainCells = componentCells(mainBin).flat();
  const skel = makeGrid(rows, cols, 0);

  // gap 由占空比推导：保留 segLen，空出 segLen*(1-keep)/keep
  const gap = Math.max(2, Math.round(segLen * (1 - keepRatio) / keepRatio));
  const minStrip = Math.max(8, Math.round(segLen * 0.35));

  // 按连通分量做 Moore 轮廓追踪，得到沿海岸的连续有序折线（无需细化）
  const coastal = binarize(coastalRoadGrid);
  for (const comp of componentCells(coastal)) {
    if (comp.length < minStrip) continue;
    const ordered = orderComponent(comp, cols);
    if (ordered.length < minStrip) continue;

    // 沿折线切出长条观光路：保留 segLen，间隔 gap，沿海岸均匀铺开
    const start = Math.floor(hash2(ordered[0].x, ordered[0].y, seed) * (segLen + gap));
    let i = start; let segIdx = 0;
    while (i < ordered.length) {
      const segEnd = Math.min(ordered.length, i + segLen);
      const seg = ordered.slice(i, segEnd);
      i = segEnd + gap; segIdx++;
      if (seg.length < minStrip) continue;

      // 铺设长条本身（沿海观光线，不再因远离主路被丢弃）
      for (const p of seg) if (land[p.y]?.[p.x]) skel[p.y][p.x] = 1;

      // 沿长条按间距生长入内陆接入主路（端点 + 内部采样点），形成支线/匝道
      if (mainCells.length === 0 || connectDist <= 0) continue;
      const anchors: Point[] = [seg[0], seg[seg.length - 1]];
      for (let k = connectSpacing; k < seg.length - 1; k += connectSpacing) anchors.push(seg[k]);
      const seenAnchor = new Set<number>();
      for (const end of anchors) {
        const aid = end.y * cols + end.x;
        if (seenAnchor.has(aid)) continue; seenAnchor.add(aid);
        const np = nearestPair([end], mainCells);
        if (np.d <= connectDist && np.d > 1.5) {
          const path = shortestPath(land, end, np.b);
          if (path.length > 0) stampSkelPath(skel, land, path);
        }
      }
    }
  }

  // 不与主路重叠
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (mainBin[y][x]) skel[y][x] = 0;

  const wide = drawRadius > 0 ? dilateClipped(skel, drawRadius, land) : skel;
  const roadGrid = wide.map((row, y) => row.map((v, x) => (v && !mainBin[y]?.[x] ? COASTAL_ROAD : 0)));
  return { roadGrid, outputGrid: roadGrid, outputNameList: NAMES };
}
