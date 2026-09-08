type Grid = number[][];

interface NameEntry {
  id: number;
  name: string;
  type?: string;
}

interface Point { x: number; y: number; }
interface HeapNode { idx: number; f: number; }
interface Tail { cells: Point[]; tip: Point; reachesMain: boolean; }

// gta_zones v3 分区 ID
const COMMERCIAL = 421;
const RESIDENTIAL = 422;
const INDUSTRIAL = 423;
const PARK = 424;
const SUBURB = 427;
const MAIN_ROAD = 300;
const AUX_ROAD = 301;
const CITY_ZONES = new Set([COMMERCIAL, RESIDENTIAL, INDUSTRIAL, SUBURB]);

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
    const first = this.data[0];
    const last = this.data.pop();
    if (!last || this.data.length === 0) return first;
    this.data[0] = last; this.down(0);
    return first;
  }
  private up(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].f <= this.data[i].f) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]]; i = p;
    }
  }
  private down(i: number): void {
    for (;;) {
      const l = i * 2 + 1, r = l + 1; let b = i;
      if (l < this.data.length && this.data[l].f < this.data[b].f) b = l;
      if (r < this.data.length && this.data[r].f < this.data[b].f) b = r;
      if (b === i) break;
      [this.data[b], this.data[i]] = [this.data[i], this.data[b]]; i = b;
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

function binarize(grid: Grid): Grid {
  return grid.map(row => row.map(v => (v ? 1 : 0)));
}

function dilateClipped(mask: Grid, radius: number, land: Grid): Grid {
  const rows = mask.length, cols = mask[0]?.length ?? 0;
  if (radius <= 0) return mask.map(r => r.slice());
  const out = makeGrid(rows, cols, 0);
  const r2 = radius * radius;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y][x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > r2) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && land[ny]?.[nx]) out[ny][nx] = 1;
        }
      }
    }
  }
  return out;
}

function dilate(mask: Grid, radius: number): Grid {
  const rows = mask.length, cols = mask[0]?.length ?? 0;
  if (radius <= 0) return mask.map(r => r.slice());
  const out = makeGrid(rows, cols, 0);
  const r2 = radius * radius;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y][x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > r2) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) out[ny][nx] = 1;
        }
      }
    }
  }
  return out;
}

// 仅保留最大陆块与面积达标的大岛，过滤小岛
function filterIslands(land: Grid, minArea: number): Grid {
  const rows = land.length, cols = land[0]?.length ?? 0;
  const comps = componentCells(land);  // 已按面积降序
  const out = makeGrid(rows, cols, 0);
  for (let i = 0; i < comps.length; i++) {
    if (i === 0 || comps[i].length >= minArea) for (const p of comps[i]) out[p.y][p.x] = 1;
  }
  return out;
}

function componentCells(grid: Grid): Point[][] {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  const seen = new Uint8Array(rows * cols);
  const out: Point[][] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const start = y * cols + x;
      if (seen[start] || !grid[y]?.[x]) continue;
      const queue = [start];
      const cells: Point[] = [];
      seen[start] = 1;
      for (let head = 0; head < queue.length; head++) {
        const idx = queue[head];
        const cx = idx % cols, cy = Math.floor(idx / cols);
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
  }
  return out.sort((a, b) => b.length - a.length);
}

function centerOf(cells: Point[]): Point {
  let sx = 0, sy = 0;
  for (const p of cells) { sx += p.x; sy += p.y; }
  return { x: sx / Math.max(1, cells.length), y: sy / Math.max(1, cells.length) };
}

function orientation(cells: Point[]): number {
  const c = centerOf(cells);
  let xx = 0, yy = 0, xy = 0;
  for (const p of cells) {
    const dx = p.x - c.x, dy = p.y - c.y;
    xx += dx * dx; yy += dy * dy; xy += dx * dy;
  }
  return 0.5 * Math.atan2(2 * xy, xx - yy);
}

function dominantZone(cells: Point[], zoneGrid: Grid): number {
  const counts = new Map<number, number>();
  for (const p of cells) {
    const v = zoneGrid[p.y]?.[p.x] ?? 0;
    if (v > 0) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let zone = 0, best = 0;
  for (const [v, c] of counts) if (c > best) { best = c; zone = v; }
  return zone;
}

function maskFromCells(rows: number, cols: number, cells: Point[]): Grid {
  const out = makeGrid(rows, cols, 0);
  for (const p of cells) out[p.y][p.x] = 1;
  return out;
}

function nearestPair(a: Point[], b: Point[]): { a: Point; b: Point; d: number } {
  let bestA = a[0], bestB = b[0], best = Infinity;
  const sa = Math.max(1, Math.floor(a.length / 200));
  const sb = Math.max(1, Math.floor(b.length / 200));
  for (let i = 0; i < a.length; i += sa) {
    for (let j = 0; j < b.length; j += sb) {
      const d = Math.hypot(a[i].x - b[j].x, a[i].y - b[j].y);
      if (d < best) { best = d; bestA = a[i]; bestB = b[j]; }
    }
  }
  return { a: bestA, b: bestB, d: best };
}

function nearestMaskPoint(mask: Grid, point: Point): Point | null {
  const rows = mask.length, cols = mask[0]?.length ?? 0;
  const sx = clamp(Math.round(point.x), 0, cols - 1);
  const sy = clamp(Math.round(point.y), 0, rows - 1);
  if (mask[sy]?.[sx]) return { x: sx, y: sy };
  for (let r = 1; r < Math.max(rows, cols); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = sx + dx, y = sy + dy;
        if (x >= 0 && y >= 0 && x < cols && y < rows && mask[y]?.[x]) return { x, y };
      }
    }
  }
  return null;
}

// routeMask 上 A* 最短路（步长成本）
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
    const cur = heap.pop();
    if (!cur) break;
    if (cur.idx === goalIdx) break;
    const x = cur.idx % cols, y = Math.floor(cur.idx / cols);
    if (cur.f > best[cur.idx] + Math.hypot(g.x - x, g.y - y) + 1e-6) continue;
    for (const [dx, dy, step] of DIR8) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !routeMask[ny]?.[nx]) continue;
      const ni = ny * cols + nx;
      const cost = best[cur.idx] + step;
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

// 在 1px 骨架上写线（端点取整逐步）
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

// 到陆地边界（海岸）的 BFS 距离
function boundaryDist(land: Grid): Grid {
  const rows = land.length, cols = land[0]?.length ?? 0;
  const dist = makeGrid(rows, cols, 999999);
  const queue: Point[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!land[y][x]) continue;
      let edge = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
      for (const [dx, dy] of N8) if (!land[y + dy]?.[x + dx]) { edge = true; break; }
      if (edge) { dist[y][x] = 0; queue.push({ x, y }); }
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    for (const [dx, dy] of N8) {
      const nx = p.x + dx, ny = p.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !land[ny]?.[nx]) continue;
      if (dist[p.y][p.x] + 1 >= dist[ny][nx]) continue;
      dist[ny][nx] = dist[p.y][p.x] + 1;
      queue.push({ x: nx, y: ny });
    }
  }
  return dist;
}

function skelDegree(skel: Grid, x: number, y: number): number {
  const rows = skel.length, cols = skel[0]?.length ?? 0;
  let n = 0;
  for (const [dx, dy] of N8) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && skel[ny][nx]) n++;
  }
  return n;
}

function isMainAdjacent(mainBin: Grid, x: number, y: number): boolean {
  const rows = mainBin.length, cols = mainBin[0]?.length ?? 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && mainBin[ny][nx]) return true;
    }
  }
  return false;
}

// 收集悬挂尾巴：从度数=1 的端点走到第一个交叉点
function collectTails(skel: Grid, mainBin: Grid): Tail[] {
  const rows = skel.length, cols = skel[0]?.length ?? 0;
  const tails: Tail[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!skel[y][x] || skelDegree(skel, x, y) !== 1) continue;
      const tip = { x, y };
      const cells: Point[] = [{ x, y }];
      let reachesMain = isMainAdjacent(mainBin, x, y);
      let cur = { x, y };
      let prev: Point | null = null;
      let guard = 0;
      for (;;) {
        if (++guard > 5000) break;
        const fwd: Point[] = [];
        for (const [dx, dy] of N8) {
          const nx = cur.x + dx, ny = cur.y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !skel[ny][nx]) continue;
          if (prev && nx === prev.x && ny === prev.y) continue;
          fwd.push({ x: nx, y: ny });
        }
        if (fwd.length !== 1) break;  // 到达交叉点(>=2)或另一端点(0)
        prev = cur;
        cur = fwd[0];
        cells.push(cur);
        if (isMainAdjacent(mainBin, cur.x, cur.y)) { reachesMain = true; break; }
      }
      tails.push({ cells, tip, reachesMain });
    }
  }
  return tails;
}

// TR 修剪：剪掉戳海岸 / 落在非城区 / 过短噪声的尾巴；按比例保留城区死胡同。
function trimSpurs(
  skel: Grid, mainBin: Grid, zoneGrid: Grid | null, bdist: Grid,
  coastBand: number, minBranchLen: number, culKeep: number, seed: number, passes: number,
  protectMask: Grid | null = null,
): void {
  for (let pass = 0; pass < passes; pass++) {
    const tails = collectTails(skel, mainBin);
    let removed = false;
    for (const tail of tails) {
      if (tail.reachesMain) continue;          // 连到主路 → 保留
      // 沿海观光道路受保护，不修剪
      if (protectMask && tail.cells.some(c => protectMask[c.y]?.[c.x])) continue;
      const tip = tail.tip;
      const tipAtCoast = (bdist[tip.y]?.[tip.x] ?? 999) <= coastBand;
      const z = zoneGrid ? (zoneGrid[tip.y]?.[tip.x] ?? 0) : COMMERCIAL;
      const tipNonCity = zoneGrid ? (!CITY_ZONES.has(z) && z !== PARK) : false;
      const short = tail.cells.length < minBranchLen;
      let remove = tipAtCoast || tipNonCity;
      if (!remove && short) {
        // 城区内短尾 = cul-de-sac：按比例保留
        remove = hash2(tip.x, tip.y, seed) >= culKeep;
      }
      if (remove) {
        for (const c of tail.cells) skel[c.y][c.x] = 0;
        removed = true;
      }
    }
    if (!removed) break;
  }
}

// 追踪 1px 连通分量为有序折线
function traceComponent(cells: Point[], bin: Grid): Point[] {
  const rows = bin.length, cols = bin[0]?.length ?? 0;
  const set = new Set(cells.map(p => p.y * cols + p.x));
  const deg = (p: Point) => {
    let n = 0;
    for (const [dx, dy] of N8) if (set.has((p.y + dy) * cols + (p.x + dx))) n++;
    return n;
  };
  let start = cells[0];
  for (const p of cells) if (deg(p) === 1) { start = p; break; }
  const order: Point[] = [];
  const visited = new Set<number>();
  let cur: Point | null = start;
  let prev: Point | null = null;
  let guard = 0;
  while (cur && ++guard < 100000) {
    order.push(cur);
    visited.add(cur.y * cols + cur.x);
    let next: Point | null = null;
    for (const [dx, dy] of N8) {
      const nx = cur.x + dx, ny = cur.y + dy;
      const id = ny * cols + nx;
      if (!set.has(id) || visited.has(id)) continue;
      if (prev && nx === prev.x && ny === prev.y) continue;
      next = { x: nx, y: ny };
      break;
    }
    prev = cur;
    cur = next;
  }
  return order;
}

// ─── BSP 城区街道 ─────────────────────────────────────────────────────────

interface BSPRect { uMin: number; uMax: number; vMin: number; vMax: number; }

function mainDirectionNear(center: Point, radius: number, mainCells: Point[]): number | null {
  const near: Point[] = [];
  for (const p of mainCells) {
    if (Math.abs(p.x - center.x) <= radius && Math.abs(p.y - center.y) <= radius) near.push(p);
  }
  if (near.length < 8) return null;
  return orientation(near);
}

const _fade = (t: number) => t * t * (3 - 2 * t);
const _lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const xf = x - x0; const yf = y - y0;
  return _lerp(
    _lerp(hash2(x0, y0, seed), hash2(x0 + 1, y0, seed), _fade(xf)),
    _lerp(hash2(x0, y0 + 1, seed), hash2(x0 + 1, y0 + 1, seed), _fade(xf)),
    _fade(yf),
  );
}

function zoneDepthLimit(zone: number): number {
  if (zone === COMMERCIAL) return 5;
  if (zone === RESIDENTIAL) return 4;
  if (zone === INDUSTRIAL) return 3;
  if (zone === SUBURB) return 2;
  return 3;
}

function zoneMinBlockSize(zone: number, gridSpacing: number): number {
  if (zone === COMMERCIAL) return gridSpacing * 0.7;
  if (zone === RESIDENTIAL) return gridSpacing * 1.2;
  if (zone === INDUSTRIAL) return gridSpacing * 2.5;
  if (zone === SUBURB) return gridSpacing * 4.0;
  return gridSpacing * 1.2;
}

function zoneStopChance(zone: number, depth: number, maxDepth: number): number {
  const base = zone === COMMERCIAL ? 0.05 : zone === RESIDENTIAL ? 0.12 : zone === INDUSTRIAL ? 0.20 : 0.30;
  return base + (depth / Math.max(1, maxDepth)) * 0.20;
}

function zonePerturbAmp(zone: number): number {
  if (zone === COMMERCIAL) return 0;
  if (zone === RESIDENTIAL) return 1.5;
  if (zone === INDUSTRIAL) return 0.8;
  if (zone === SUBURB) return 3.0;
  return 1.0;
}

function sampleZoneAt(
  zoneGrid: Grid, center: Point, ca: number, sa: number, u: number, v: number,
): number {
  const wx = Math.round(center.x + u * ca - v * sa);
  const wy = Math.round(center.y + u * sa + v * ca);
  const rows = zoneGrid.length, cols = zoneGrid[0]?.length ?? 0;
  if (wx >= 0 && wy >= 0 && wy < rows && wx < cols) return zoneGrid[wy]?.[wx] ?? 0;
  return 0;
}

function drawBSPLine(
  skel: Grid, drawMask: Grid, center: Point, ca: number, sa: number,
  fixedCoord: number, rangeMin: number, rangeMax: number, isU: boolean,
  perturbAmp = 0, perturbSeed = 0,
): void {
  const rows = skel.length, cols = skel[0]?.length ?? 0;
  for (let t = rangeMin; t <= rangeMax; t += 0.5) {
    const offset = perturbAmp > 0
      ? (valueNoise(t * 0.06, fixedCoord * 0.08, perturbSeed) - 0.5) * 2 * perturbAmp
      : 0;
    const u = isU ? (fixedCoord + offset) : t;
    const v = isU ? t : (fixedCoord + offset);
    const wx = Math.round(center.x + u * ca - v * sa);
    const wy = Math.round(center.y + u * sa + v * ca);
    if (wx >= 0 && wy >= 0 && wy < rows && wx < cols && drawMask[wy][wx]) skel[wy][wx] = 1;
  }
}

function bspSubdivide(
  skel: Grid, drawMask: Grid, zoneGrid: Grid | null,
  center: Point, ca: number, sa: number,
  rect: BSPRect, depth: number, fallbackZone: number,
  gridSpacing: number, seed: number,
): void {
  const uLen = rect.uMax - rect.uMin;
  const vLen = rect.vMax - rect.vMin;

  const uMid = (rect.uMin + rect.uMax) / 2;
  const vMid = (rect.vMin + rect.vMax) / 2;
  const localZone = zoneGrid ? sampleZoneAt(zoneGrid, center, ca, sa, uMid, vMid) : fallbackZone;
  const zone = CITY_ZONES.has(localZone) ? localZone : fallbackZone;

  const maxDepth = zoneDepthLimit(zone);
  const minBlock = zoneMinBlockSize(zone, gridSpacing);

  if (depth >= maxDepth) return;
  if (uLen < minBlock * 1.6 && vLen < minBlock * 1.6) return;

  if (depth >= 2) {
    const stop = zoneStopChance(zone, depth, maxDepth);
    if (hash2(Math.floor(rect.uMin * 10 + rect.vMax), depth * 31 + 7, seed) < stop) return;
  }

  let splitU: boolean;
  if (uLen > vLen * 1.25) splitU = true;
  else if (vLen > uLen * 1.25) splitU = false;
  else splitU = hash2(Math.floor(rect.uMin * 37), Math.floor(rect.vMin * 53), seed + depth * 113) > 0.5;

  const dim = splitU ? uLen : vLen;
  if (dim < minBlock * 1.6) {
    const otherDim = splitU ? vLen : uLen;
    if (otherDim >= minBlock * 1.6) splitU = !splitU;
    else return;
  }

  const ratio = 0.30 + hash2(
    Math.floor((rect.uMin + rect.uMax) * 37),
    Math.floor((rect.vMin + rect.vMax) * 53),
    seed + depth * 997,
  ) * 0.40;

  const perturb = zonePerturbAmp(zone);
  const childSeed = (seed * 2654435761) >>> 0;

  if (splitU) {
    const splitPos = rect.uMin + uLen * ratio;
    drawBSPLine(skel, drawMask, center, ca, sa, splitPos, rect.vMin, rect.vMax, true, perturb, seed + depth * 313);
    bspSubdivide(skel, drawMask, zoneGrid, center, ca, sa,
      { uMin: rect.uMin, uMax: splitPos, vMin: rect.vMin, vMax: rect.vMax },
      depth + 1, zone, gridSpacing, childSeed + 1);
    bspSubdivide(skel, drawMask, zoneGrid, center, ca, sa,
      { uMin: splitPos, uMax: rect.uMax, vMin: rect.vMin, vMax: rect.vMax },
      depth + 1, zone, gridSpacing, childSeed + 2);
  } else {
    const splitPos = rect.vMin + vLen * ratio;
    drawBSPLine(skel, drawMask, center, ca, sa, splitPos, rect.uMin, rect.uMax, false, perturb, seed + depth * 313);
    bspSubdivide(skel, drawMask, zoneGrid, center, ca, sa,
      { uMin: rect.uMin, uMax: rect.uMax, vMin: rect.vMin, vMax: splitPos },
      depth + 1, zone, gridSpacing, childSeed + 3);
    bspSubdivide(skel, drawMask, zoneGrid, center, ca, sa,
      { uMin: rect.uMin, uMax: rect.uMax, vMin: splitPos, vMax: rect.vMax },
      depth + 1, zone, gridSpacing, childSeed + 4);
  }
}

const BSP_ANGLE_OFFSETS = [0, 0, 0, 0, Math.PI * 0.05, -Math.PI * 0.05, Math.PI * 0.10, -Math.PI * 0.10, Math.PI * 0.18];

function drawCityGrid(
  skel: Grid, land: Grid, regionCells: Point[], drawMask: Grid,
  zoneGrid: Grid, mainCells: Point[], gridSpacing: number, seed: number,
): void {
  if (regionCells.length < 20) return;
  const c = centerOf(regionCells);
  const dirRadius = Math.max(24, gridSpacing * 3);
  const baseAngle = mainDirectionNear(c, dirRadius, mainCells) ?? 0;
  const offsetIdx = Math.floor(hash2(Math.floor(c.x), Math.floor(c.y), seed + 777) * BSP_ANGLE_OFFSETS.length);
  const angle = baseAngle + BSP_ANGLE_OFFSETS[offsetIdx % BSP_ANGLE_OFFSETS.length];

  const ca = Math.cos(angle), sa = Math.sin(angle);
  const zone = dominantZone(regionCells, zoneGrid);

  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const p of regionCells) {
    const dx = p.x - c.x, dy = p.y - c.y;
    const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
    if (u < uMin) uMin = u; if (u > uMax) uMax = u;
    if (v < vMin) vMin = v; if (v > vMax) vMax = v;
  }

  const pad = gridSpacing * 0.3;
  uMin -= pad; uMax += pad; vMin -= pad; vMax += pad;

  bspSubdivide(skel, drawMask, zoneGrid, c, ca, sa,
    { uMin, uMax, vMin, vMax }, 0, zone, gridSpacing, seed);
  void land;
}

// 道路交接处倒圆角：在交叉点(度数>=3)补半径1圆盘
function roundJunctions(skel: Grid, mainBin: Grid, land: Grid): void {
  const rows = skel.length, cols = skel[0]?.length ?? 0;
  const junctions: Point[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!skel[y][x]) continue;
      let deg = 0;
      for (const [dx, dy] of N8) {
        const nx = x + dx, ny = y + dy;
        if ((nx >= 0 && ny >= 0 && nx < cols && ny < rows) && (skel[ny][nx] || mainBin[ny]?.[nx])) deg++;
      }
      if (deg >= 3) junctions.push({ x, y });
    }
  }
  for (const j of junctions) {
    for (const [dx, dy] of N8) {
      const nx = j.x + dx, ny = j.y + dy;
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && land[ny][nx] && (dx * dx + dy * dy) <= 2) skel[ny][nx] = 1;
    }
  }
}

const NAMES: NameEntry[] = [
  { id: MAIN_ROAD, name: "GTA 主干路", type: "tile" },
  { id: AUX_ROAD, name: "GTA 辅路", type: "tile" },
];

export function gtaAuxRoads(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.mainRoadGrid)) return { error: "mainRoadGrid is required" };
  const mainRoadGrid = input.mainRoadGrid as Grid;
  const zoneGrid = isGrid(input.zoneGrid) ? input.zoneGrid as Grid : null;
  const buildableMask = isGrid(input.buildableMask) ? input.buildableMask as Grid : null;
  const connectedRoadGrid = isGrid(input.connectedRoadGrid) ? input.connectedRoadGrid as Grid : null;
  const coastalRoadGrid = isGrid(input.coastalRoadGrid) ? input.coastalRoadGrid as Grid : null;
  const rows = mainRoadGrid.length, cols = mainRoadGrid[0]?.length ?? 0;
  const rawLand = isGrid(input.landGrid)
    ? binarize(input.landGrid as Grid)
    : (buildableMask ? binarize(buildableMask) : makeGrid(rows, cols, 1));

  const seed = resolveSeed(input.seed);
  const gridSpacing = clamp(int(input, "gridSpacing", 20), 4, 80);
  const roadWidth = clamp(int(input, "roadWidth", 1), 1, 5);
  const coastalKeepRatio = clamp(num(input, "coastalKeepRatio", 0.4), 0, 1);
  const coastalSegLen = clamp(int(input, "coastalSegLen", 36), 8, 120);
  const coastalConnectDist = clamp(int(input, "coastalConnectDist", 80), 4, 200);
  const cutWidth = clamp(int(input, "cutWidth", 0), 0, 4);
  const minIslandArea = clamp(int(input, "minIslandArea", 1200), 0, 20000);

  // 过滤小岛：辅路只在大陆块上生成
  const land = filterIslands(rawLand, minIslandArea);
  // 受保护单元（沿海观光道路）：TR 修剪不可删除
  const protectMask = makeGrid(rows, cols, 0);
  const drawRadius = Math.floor((roadWidth - 1) / 2);

  const mainBin = binarize(mainRoadGrid);
  const mainCells = componentCells(mainBin).flat();
  const mainBuffer = cutWidth > 0 ? dilate(mainBin, cutWidth) : mainBin;
  const bdist = boundaryDist(land);

  const skel = makeGrid(rows, cols, 0);

  // ── 步骤 1：连接道路写入（仅城区，避免穿越公园/绿化；后续被主路切割 + TR 修剪）──
  if (connectedRoadGrid) {
    const conn = binarize(connectedRoadGrid);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (!conn[y][x] || !land[y][x]) continue;
        // 有分区信息时只保留城区内的连接道路；无分区则全保留
        if (zoneGrid && !CITY_ZONES.has(zoneGrid[y]?.[x] ?? 0)) continue;
        skel[y][x] = 1;
      }
  }

  // ── 步骤 2：沿海道路分段抽取 + 端头生长到主路 ──
  if (coastalRoadGrid && mainCells.length > 0) {
    const coastal = binarize(coastalRoadGrid);
    const gap = Math.max(6, Math.round(coastalSegLen * 0.7));
    for (const comp of componentCells(coastal)) {
      if (comp.length < 6) continue;
      const ordered = traceComponent(comp, coastal);
      let i = 0;
      let segIdx = 0;
      while (i < ordered.length) {
        const segEnd = Math.min(ordered.length, i + coastalSegLen);
        const seg = ordered.slice(i, segEnd);
        i = segEnd + gap;  // 段间留间隙
        segIdx++;
        if (seg.length < 8) continue;
        // 按比例抽取
        if (hash2(seg[0].x, seg[0].y, seed + segIdx * 13) >= coastalKeepRatio) continue;
        // 两端必须能接到主路
        const head = seg[0], tail = seg[seg.length - 1];
        const dh = nearestPair([head], mainCells).d;
        const dt = nearestPair([tail], mainCells).d;
        if (dh > coastalConnectDist && dt > coastalConnectDist) continue;
        // 写入段（标记为受保护）
        for (const p of seg) if (land[p.y][p.x]) { skel[p.y][p.x] = 1; protectMask[p.y][p.x] = 1; }
        // 端头生长到主路
        for (const end of [head, tail]) {
          const np = nearestPair([end], mainCells);
          if (np.d <= coastalConnectDist && np.d > 1.5) {
            const path = shortestPath(land, end, np.b);
            if (path.length > 0) {
              stampSkelPath(skel, land, path);
              for (const p of path) if (land[p.y]?.[p.x]) protectMask[p.y][p.x] = 1;
            }
          }
        }
      }
    }
  }

  // ── 步骤 3：城区 BSP 街道网格 ──
  if (zoneGrid && buildableMask) {
    const superBlockMask = makeGrid(rows, cols, 0);
    const drawMask = makeGrid(rows, cols, 0);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (!land[y][x] || !buildableMask[y]?.[x] || !CITY_ZONES.has(zoneGrid[y]?.[x] ?? 0)) continue;
        drawMask[y][x] = 1;
        if (!mainBin[y][x] && !skel[y][x]) superBlockMask[y][x] = 1;
      }
    const minRegionArea = Math.max(60, gridSpacing * gridSpacing * 1.3);
    let ri = 0;
    for (const region of componentCells(superBlockMask)) {
      if (region.length < minRegionArea) continue;
      drawCityGrid(skel, land, region, drawMask, zoneGrid, mainCells, gridSpacing, seed + ri * 1009);
      ri++;
    }
  }

  // ── 主路切割（TR 前先断开重叠）──
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (mainBuffer[y][x]) skel[y][x] = 0;

  // ── TR 修剪不合理出头 ──
  trimSpurs(skel, mainBin, zoneGrid, bdist, 6, gridSpacing, 0.3, seed + 777, 4, protectMask);

  // ── 接入校验：较大孤立辅路片接到主路 ──
  if (mainCells.length > 0) {
    const mainTouch = dilate(mainBin, 1);
    for (let pass = 0; pass < 2; pass++) {
      let changed = false;
      for (const cells of componentCells(skel)) {
        if (cells.length < Math.max(10, gridSpacing)) continue;
        if (cells.some(p => mainTouch[p.y]?.[p.x])) continue;
        const np = nearestPair(cells, mainCells);
        const path = shortestPath(land, np.a, np.b);
        if (path.length > 0) { stampSkelPath(skel, land, path); changed = true; }
      }
      if (!changed) break;
    }
    // 接入后再切一次（让接入处恰好抵住主路）
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++)
        if (mainBuffer[y][x]) skel[y][x] = 0;
  }

  // ── 倒圆角 + 清理碎块 ──
  roundJunctions(skel, mainBin, land);
  const minKeep = Math.max(4, Math.round(gridSpacing * 0.4));
  for (const cells of componentCells(skel)) {
    if (cells.length < minKeep) for (const p of cells) skel[p.y][p.x] = 0;
  }

  // ── 膨胀到辅路宽度 + 输出 ──
  const auxWide = drawRadius > 0 ? dilateClipped(skel, drawRadius, land) : skel;
  const auxRoadGrid = auxWide.map((row, y) => row.map((v, x) => (v && !mainBin[y][x] ? AUX_ROAD : 0)));
  const roadGrid = auxRoadGrid.map((row, y) => row.map((v, x) => (mainBin[y][x] ? MAIN_ROAD : v)));
  return { roadGrid, auxRoadGrid, outputGrid: roadGrid, outputNameList: NAMES };
}
