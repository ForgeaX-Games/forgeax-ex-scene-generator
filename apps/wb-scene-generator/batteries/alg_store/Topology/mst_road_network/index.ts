/**
 * mst_road_network
 * 最小生成树路网（Kruskal / Prim），把边光栅化为路网网格。
 */

type Grid = number[][];
type Point = [number, number];
type Edge = { from: Point; to: Point; cost: number; mst: boolean; iFrom: number; iTo: number };

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
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0, y = y0;
  while (true) {
    if (x >= 0 && x < w && y >= 0 && y < h) grid[y][x] = 1;
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function gridPathCost(start: Point, end: Point, costGrid: Grid, diag: boolean): number {
  const h = costGrid.length;
  const w = costGrid[0].length;
  if (start[0] < 0 || start[0] >= w || start[1] < 0 || start[1] >= h) return Infinity;
  if (end[0] < 0 || end[0] >= w || end[1] < 0 || end[1] >= h) return Infinity;
  const total = w * h;
  const dist = new Float64Array(total).fill(Infinity);
  const startIdx = start[1] * w + start[0];
  const endIdx = end[1] * w + end[0];
  dist[startIdx] = 0;
  const heap: number[] = [startIdx];
  const dxArr = diag ? [1, 1, 0, -1, -1, -1, 0, 1] : [1, 0, -1, 0];
  const dyArr = diag ? [0, 1, 1, 1, 0, -1, -1, -1] : [0, 1, 0, -1];
  const SQRT2 = Math.SQRT2;
  while (heap.length > 0) {
    let bestI = 0;
    for (let i = 1; i < heap.length; i++) if (dist[heap[i]] < dist[heap[bestI]]) bestI = i;
    const cur = heap[bestI];
    heap.splice(bestI, 1);
    if (cur === endIdx) return dist[cur];
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (let d = 0; d < dxArr.length; d++) {
      const nx = cx + dxArr[d];
      const ny = cy + dyArr[d];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const cell = costGrid[ny][nx];
      if (cell <= 0) continue;
      const step = (diag && d % 2 === 1) ? cell * SQRT2 : cell;
      const nd = dist[cur] + step;
      const nIdx = ny * w + nx;
      if (nd < dist[nIdx]) {
        dist[nIdx] = nd;
        heap.push(nIdx);
      }
    }
  }
  return isFinite(dist[endIdx]) ? dist[endIdx] : Infinity;
}

class DSU {
  parent: number[];
  rank: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = new Array(n).fill(0);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): boolean {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return false;
    if (this.rank[ra] < this.rank[rb]) this.parent[ra] = rb;
    else if (this.rank[ra] > this.rank[rb]) this.parent[rb] = ra;
    else { this.parent[rb] = ra; this.rank[ra]++; }
    return true;
  }
}

function distance(a: Point, b: Point, metric: string): number {
  const dx = a[0] - b[0], dy = a[1] - b[1];
  if (metric === "manhattan") return Math.abs(dx) + Math.abs(dy);
  return Math.sqrt(dx * dx + dy * dy);
}

export function mstRoadNetwork(input: Record<string, unknown>): Record<string, unknown> {
  const points = parsePointList(input.points);
  const grid = input.grid as Grid | undefined;
  const algorithm = typeof input.algorithm === "string" ? input.algorithm : "kruskal";
  const metric = typeof input.metric === "string" ? input.metric : "euclidean";
  const extraRatio = Math.max(0, Math.min(1, typeof input.extraEdgeRatio === "number" ? input.extraEdgeRatio : 0));
  const diag = input.diagonal === undefined ? true : !!input.diagonal;

  let w = Math.max(1, Math.floor(typeof input.width === "number" ? input.width : 64));
  let h = Math.max(1, Math.floor(typeof input.height === "number" ? input.height : 64));
  if (grid && grid.length > 0 && grid[0]?.length > 0) {
    h = grid.length;
    w = grid[0].length;
  }

  if (points.length < 2) {
    return { roadGrid: emptyGrid(w, h, 0), edges: [], totalCost: 0 };
  }

  const n = points.length;
  const allEdges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let cost: number;
      if (metric === "grid_path" && grid) {
        cost = gridPathCost(points[i], points[j], grid, diag);
      } else {
        cost = distance(points[i], points[j], metric);
      }
      if (!isFinite(cost)) continue;
      allEdges.push({ from: points[i], to: points[j], cost, mst: false, iFrom: i, iTo: j });
    }
  }
  allEdges.sort((a, b) => a.cost - b.cost);

  const mstEdges: Edge[] = [];
  if (algorithm === "prim") {
    const inTree = new Array(n).fill(false);
    inTree[0] = true;
    while (mstEdges.length < n - 1) {
      let best: Edge | null = null;
      for (const e of allEdges) {
        if (inTree[e.iFrom] !== inTree[e.iTo]) {
          if (!best || e.cost < best.cost) best = e;
        }
      }
      if (!best) break;
      best.mst = true;
      mstEdges.push(best);
      inTree[best.iFrom] = true;
      inTree[best.iTo] = true;
    }
  } else {
    const dsu = new DSU(n);
    for (const e of allEdges) {
      if (dsu.union(e.iFrom, e.iTo)) {
        e.mst = true;
        mstEdges.push(e);
        if (mstEdges.length === n - 1) break;
      }
    }
  }

  const remaining = allEdges.filter(e => !e.mst);
  const extraCount = Math.floor(remaining.length * extraRatio);
  const extraEdges = remaining.slice(0, extraCount);

  const outputEdges = [...mstEdges, ...extraEdges];

  const roadGrid = emptyGrid(w, h, 0);
  for (const e of outputEdges) {
    rasterizeLine(roadGrid, e.from[0], e.from[1], e.to[0], e.to[1], w, h);
  }

  let totalCost = 0;
  const exposedEdges = outputEdges.map(e => {
    totalCost += e.cost;
    return { from: e.from, to: e.to, cost: Math.round(e.cost * 1000) / 1000, mst: e.mst };
  });

  return {
    roadGrid,
    edges: exposedEdges,
    totalCost: Math.round(totalCost * 1000) / 1000,
  };
}
