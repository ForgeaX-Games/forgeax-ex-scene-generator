/**
 * tsp_approximation
 * TSP 近似：最近邻贪心 + 2-opt 翻转优化。
 */

type Grid = number[][];
type Point = [number, number];

function parsePointList(raw: unknown): Point[] {
  // 端口声明 number rank=2，但用户用老字符串格式时 dispatcher 会做 rank-promotion 包装
  // （`"x,y; ..."` → `[["x,y; ..."]]`）。这里先剥掉单元素外壳还原字符串。
  if (Array.isArray(raw)) {
    let probe: unknown = raw;
    while (Array.isArray(probe) && probe.length === 1) probe = probe[0];
    if (typeof probe === "string") raw = probe;
  }
  if (Array.isArray(raw)) {
    const out: Point[] = [];
    for (const item of raw) {
      if (Array.isArray(item) && item.length >= 2) {
        const x = Number(item[0]);
        const y = Number(item[1]);
        if (isFinite(x) && isFinite(y)) out.push([Math.floor(x), Math.floor(y)]);
      }
    }
    return out;
  }
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const out: Point[] = [];
  for (const seg of raw.split(/[;\n]/)) {
    const cleaned = seg.replace(/[\[\]\s]/g, "");
    if (!cleaned) continue;
    const parts = cleaned.split(",");
    if (parts.length >= 2) {
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      if (isFinite(x) && isFinite(y)) out.push([Math.floor(x), Math.floor(y)]);
    }
  }
  return out;
}

function emptyGrid(w: number, h: number, fill = 0): Grid {
  const g: Grid = new Array(h);
  for (let y = 0; y < h; y++) g[y] = new Array(w).fill(fill);
  return g;
}

function rasterizeLine(grid: Grid, x0: number, y0: number, x1: number, y1: number, w: number, h: number) {
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  while (true) {
    if (x >= 0 && x < w && y >= 0 && y < h) grid[y][x] = 1;
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function dist(a: Point, b: Point, metric: string): number {
  const dx = a[0] - b[0], dy = a[1] - b[1];
  if (metric === "manhattan") return Math.abs(dx) + Math.abs(dy);
  return Math.sqrt(dx * dx + dy * dy);
}

function nearestNeighborTour(points: Point[], start: number, metric: string): number[] {
  const n = points.length;
  const visited = new Array(n).fill(false);
  const order: number[] = [start];
  visited[start] = true;
  let cur = start;
  for (let k = 1; k < n; k++) {
    let bestJ = -1, bestD = Infinity;
    for (let j = 0; j < n; j++) {
      if (visited[j]) continue;
      const d = dist(points[cur], points[j], metric);
      if (d < bestD) { bestD = d; bestJ = j; }
    }
    if (bestJ === -1) break;
    visited[bestJ] = true;
    order.push(bestJ);
    cur = bestJ;
  }
  return order;
}

function tourLength(order: number[], points: Point[], metric: string, closed: boolean): number {
  let total = 0;
  for (let k = 0; k + 1 < order.length; k++) {
    total += dist(points[order[k]], points[order[k + 1]], metric);
  }
  if (closed && order.length >= 2) {
    total += dist(points[order[order.length - 1]], points[order[0]], metric);
  }
  return total;
}

function twoOpt(order: number[], points: Point[], metric: string, closed: boolean, maxIter: number): number[] {
  const n = order.length;
  if (n < 4) return order;
  let route = order.slice();
  let improved = true;
  let iter = 0;
  const limit = closed ? n : n - 1;
  while (improved && iter < maxIter) {
    improved = false;
    for (let i = 0; i < limit - 1 && iter < maxIter; i++) {
      for (let k = i + 2; k < limit && iter < maxIter; k++) {
        if (closed && i === 0 && k === n - 1) continue;
        const a = route[i];
        const b = route[i + 1];
        const c = route[k];
        const d = route[(k + 1) % n];
        if (!closed && k + 1 >= n) continue;
        const oldD = dist(points[a], points[b], metric) + dist(points[c], points[d], metric);
        const newD = dist(points[a], points[c], metric) + dist(points[b], points[d], metric);
        if (newD + 1e-9 < oldD) {
          let lo = i + 1, hi = k;
          while (lo < hi) { [route[lo], route[hi]] = [route[hi], route[lo]]; lo++; hi--; }
          improved = true;
        }
        iter++;
      }
    }
  }
  return route;
}

class LCG {
  private s: number;
  constructor(seed: number) { this.s = seed > 0 ? seed : 48271; }
  next(): number { this.s = (this.s * 1103515245 + 12345) & 0x7fffffff; return this.s; }
  intn(n: number): number { return n <= 0 ? 0 : this.next() % n; }
}

export function tspApproximation(input: Record<string, unknown>): Record<string, unknown> {
  const points = parsePointList(input.points);
  const closed = input.closed === undefined ? true : !!input.closed;
  const algorithm = typeof input.algorithm === "string" ? input.algorithm : "nearest_2opt";
  const metric = typeof input.metric === "string" ? input.metric : "euclidean";
  const maxIter = Math.max(1, Math.floor(typeof input.maxIterations === "number" ? input.maxIterations : 1000));
  const w = Math.max(1, Math.floor(typeof input.width === "number" ? input.width : 64));
  const h = Math.max(1, Math.floor(typeof input.height === "number" ? input.height : 64));
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() & 0x7fffffff : seedRaw;

  if (points.length < 2) {
    return { order: [], pathPoints: [], pathGrid: emptyGrid(w, h, 0), totalLength: 0 };
  }

  const rng = new LCG(seed);
  const start = rng.intn(points.length);

  let order = nearestNeighborTour(points, start, metric);
  if (algorithm === "nearest_2opt") {
    order = twoOpt(order, points, metric, closed, maxIter);
  }

  const total = tourLength(order, points, metric, closed);

  const pathPoints: Point[] = order.map(i => points[i]);
  if (closed && pathPoints.length > 0) pathPoints.push(pathPoints[0]);

  const pathGrid = emptyGrid(w, h, 0);
  for (let k = 0; k + 1 < pathPoints.length; k++) {
    rasterizeLine(pathGrid, pathPoints[k][0], pathPoints[k][1], pathPoints[k + 1][0], pathPoints[k + 1][1], w, h);
  }

  return {
    order,
    pathPoints,
    pathGrid,
    totalLength: Math.round(total * 1000) / 1000,
  };
}
