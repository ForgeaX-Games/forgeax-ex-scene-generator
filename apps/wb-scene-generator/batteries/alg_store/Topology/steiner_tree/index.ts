/**
 * steiner_tree
 * 经典启发式：构造 terminals 间的距离图（metric closure），
 * 在距离图上跑 MST，再把每条 MST 边展开为实际最短路，
 * 把展开路径上的非 terminal 节点列为 Steiner 点。
 */

type Grid = number[][];
type Point = [number, number];

const DX8 = [1, 1, 0, -1, -1, -1, 0, 1];
const DY8 = [0, 1, 1, 1, 0, -1, -1, -1];

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

class DSU {
  parent: number[];
  constructor(n: number) { this.parent = Array.from({ length: n }, (_, i) => i); }
  find(x: number): number {
    while (this.parent[x] !== x) { this.parent[x] = this.parent[this.parent[x]]; x = this.parent[x]; }
    return x;
  }
  union(a: number, b: number): boolean {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return false;
    this.parent[ra] = rb;
    return true;
  }
}

function gridDijkstra(start: Point, costGrid: Grid, diag: boolean, w: number, h: number): { dist: Float64Array; parent: Int32Array } {
  const total = w * h;
  const dist = new Float64Array(total).fill(Infinity);
  const parent = new Int32Array(total).fill(-1);
  const sIdx = start[1] * w + start[0];
  if (start[0] < 0 || start[0] >= w || start[1] < 0 || start[1] >= h) return { dist, parent };
  if (costGrid[start[1]][start[0]] <= 0) return { dist, parent };
  dist[sIdx] = 0;
  const heap: number[] = [sIdx];
  const dxArr = diag ? DX8 : [1, 0, -1, 0];
  const dyArr = diag ? [0, 1, 1, 1, 0, -1, -1, -1] : [0, 1, 0, -1];
  const SQRT2 = Math.SQRT2;
  while (heap.length > 0) {
    let bestI = 0;
    for (let i = 1; i < heap.length; i++) if (dist[heap[i]] < dist[heap[bestI]]) bestI = i;
    const cur = heap[bestI];
    heap.splice(bestI, 1);
    const cx = cur % w, cy = (cur - cx) / w, cd = dist[cur];
    for (let d = 0; d < dxArr.length; d++) {
      const nx = cx + dxArr[d], ny = cy + dyArr[d];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const cell = costGrid[ny][nx];
      if (cell <= 0) continue;
      const step = (diag && d % 2 === 1) ? cell * SQRT2 : cell;
      const nIdx = ny * w + nx;
      const nd = cd + step;
      if (nd < dist[nIdx]) { dist[nIdx] = nd; parent[nIdx] = cur; heap.push(nIdx); }
    }
  }
  return { dist, parent };
}

export function steinerTree(input: Record<string, unknown>): Record<string, unknown> {
  const terminals = parsePointList(input.terminals);
  const grid = input.grid as Grid | undefined;
  const metric = typeof input.metric === "string" ? input.metric : "grid";
  const diag = input.diagonal === undefined ? true : !!input.diagonal;

  let w: number, h: number, costGrid: Grid;
  if (grid && grid.length > 0 && grid[0]?.length > 0) {
    h = grid.length; w = grid[0].length; costGrid = grid;
  } else {
    w = Math.max(1, Math.floor(typeof input.width === "number" ? input.width : 64));
    h = Math.max(1, Math.floor(typeof input.height === "number" ? input.height : 64));
    costGrid = emptyGrid(w, h, 1);
  }

  if (terminals.length < 2) {
    return { treeGrid: emptyGrid(w, h, 0), edges: [], steinerPoints: [], totalLength: 0 };
  }

  const useGridMetric = metric === "grid";
  const n = terminals.length;
  const distMatrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(Infinity));
  const dijkResults: Array<{ dist: Float64Array; parent: Int32Array } | null> = new Array(n).fill(null);

  for (let i = 0; i < n; i++) {
    if (useGridMetric) {
      dijkResults[i] = gridDijkstra(terminals[i], costGrid, diag, w, h);
      for (let j = 0; j < n; j++) {
        if (i === j) { distMatrix[i][j] = 0; continue; }
        const idx = terminals[j][1] * w + terminals[j][0];
        distMatrix[i][j] = dijkResults[i]!.dist[idx];
      }
    } else {
      for (let j = 0; j < n; j++) {
        if (i === j) { distMatrix[i][j] = 0; continue; }
        const dx = terminals[i][0] - terminals[j][0];
        const dy = terminals[i][1] - terminals[j][1];
        distMatrix[i][j] = Math.sqrt(dx * dx + dy * dy);
      }
    }
  }

  type ME = { i: number; j: number; cost: number };
  const allEdges: ME[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (isFinite(distMatrix[i][j])) {
        allEdges.push({ i, j, cost: distMatrix[i][j] });
      }
    }
  }
  allEdges.sort((a, b) => a.cost - b.cost);

  const dsu = new DSU(n);
  const mst: ME[] = [];
  for (const e of allEdges) {
    if (dsu.union(e.i, e.j)) {
      mst.push(e);
      if (mst.length === n - 1) break;
    }
  }

  // 当 grid 上 terminal 互相不可达时，MST 会缺少边数 (< n-1)，导致 treeGrid
  // 实际无法连通所有 terminal。这里显式报告未连通的 terminal 数量给上层。
  if (mst.length < n - 1) {
    const componentRoots = new Set<number>();
    for (let i = 0; i < n; i++) componentRoots.add(dsu.find(i));
    return {
      treeGrid: emptyGrid(w, h, 0),
      edges: [],
      steinerPoints: [],
      totalLength: 0,
      error: `Cannot connect all ${n} terminals: ${componentRoots.size} disconnected components (some terminals unreachable on the cost grid). Check obstacleValue and terminal positions.`,
    };
  }

  const treeGrid = emptyGrid(w, h, 0);
  const terminalSet = new Set(terminals.map(p => p[1] * w + p[0]));
  const steinerSet = new Set<number>();

  for (const e of mst) {
    if (useGridMetric && dijkResults[e.i]) {
      const { parent } = dijkResults[e.i]!;
      let cur = terminals[e.j][1] * w + terminals[e.j][0];
      const path: number[] = [];
      while (cur !== -1) { path.push(cur); cur = parent[cur]; }
      for (const idx of path) {
        const x = idx % w, y = (idx - x) / w;
        treeGrid[y][x] = 1;
        if (!terminalSet.has(idx)) steinerSet.add(idx);
      }
    } else {
      rasterizeLine(treeGrid, terminals[e.i][0], terminals[e.i][1], terminals[e.j][0], terminals[e.j][1], w, h);
    }
  }

  if (!useGridMetric) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (treeGrid[y][x] === 1) {
          const idx = y * w + x;
          if (!terminalSet.has(idx)) steinerSet.add(idx);
        }
      }
    }
  }

  let totalLength = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (treeGrid[y][x] === 1) totalLength++;

  const steinerPoints: Point[] = [];
  for (const idx of steinerSet) {
    const x = idx % w, y = (idx - x) / w;
    steinerPoints.push([x, y]);
  }

  const edges = mst.map(e => ({
    from: terminals[e.i],
    to: terminals[e.j],
    cost: Math.round(e.cost * 1000) / 1000,
  }));

  return { treeGrid, edges, steinerPoints, totalLength };
}
