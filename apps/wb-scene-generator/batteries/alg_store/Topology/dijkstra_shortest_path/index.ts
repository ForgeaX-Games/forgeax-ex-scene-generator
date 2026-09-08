/**
 * dijkstra_shortest_path
 * 多源/多终点 Dijkstra 最短路。
 * 输入：costGrid (grid)、sources/targets (string)、diagonal、obstacleValue
 * 输出：distanceGrid（不可达 = -1）、pathGrid（终点路径并集 0/1）、parentGrid（前驱方向 1~8）
 */

type Grid = number[][];

const DX8 = [1, 1, 0, -1, -1, -1, 0, 1];
const DY8 = [0, 1, 1, 1, 0, -1, -1, -1];
const SQRT2 = Math.SQRT2;

function parsePointList(raw: unknown): Array<[number, number]> {
  // 端口声明 number rank=2，但用户用老字符串格式时 dispatcher 会做 rank-promotion 包装
  // （`"x,y; ..."` → `[["x,y; ..."]]`）。这里先剥掉单元素外壳还原字符串。
  if (Array.isArray(raw)) {
    let probe: unknown = raw;
    while (Array.isArray(probe) && probe.length === 1) probe = probe[0];
    if (typeof probe === "string") raw = probe;
  }
  if (Array.isArray(raw)) {
    const out: Array<[number, number]> = [];
    for (const item of raw) {
      if (Array.isArray(item) && item.length >= 2) {
        const x = Number(item[0]);
        const y = Number(item[1]);
        if (isFinite(x) && isFinite(y)) out.push([x, y]);
      }
    }
    return out;
  }
  if (typeof raw !== "string" || raw.trim() === "") return [];
  const out: Array<[number, number]> = [];
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

class MinHeap {
  private data: number[] = [];
  private dist: Float64Array;
  constructor(dist: Float64Array) {
    this.dist = dist;
  }
  get size() { return this.data.length; }
  push(node: number) {
    this.data.push(node);
    this.bubbleUp(this.data.length - 1);
  }
  pop(): number {
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }
  private bubbleUp(i: number) {
    const d = this.data, dist = this.dist;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (dist[d[i]] >= dist[d[p]]) break;
      [d[i], d[p]] = [d[p], d[i]];
      i = p;
    }
  }
  private sinkDown(i: number) {
    const d = this.data, dist = this.dist, n = d.length;
    while (true) {
      let s = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && dist[d[l]] < dist[d[s]]) s = l;
      if (r < n && dist[d[r]] < dist[d[s]]) s = r;
      if (s === i) break;
      [d[i], d[s]] = [d[s], d[i]];
      i = s;
    }
  }
}

export function dijkstraShortestPath(input: Record<string, unknown>): Record<string, unknown> {
  const costRaw = input.costGrid as Grid | undefined;
  const obstacleValue = typeof input.obstacleValue === "number" ? input.obstacleValue : 0;
  const diag = !!input.diagonal;

  let h: number, w: number, costGrid: Grid;
  if (costRaw && costRaw.length > 0 && costRaw[0]?.length > 0) {
    h = costRaw.length;
    w = costRaw[0].length;
    costGrid = costRaw;
  } else {
    w = Math.max(1, Math.floor(typeof input.width === "number" ? input.width : 64));
    h = Math.max(1, Math.floor(typeof input.height === "number" ? input.height : 64));
    costGrid = emptyGrid(w, h, 1);
  }

  const total = w * h;
  const dist = new Float64Array(total).fill(Infinity);
  const parent = new Int32Array(total).fill(-1);
  const parentDir = new Int8Array(total).fill(-1);

  const heap = new MinHeap(dist);
  const sources = parsePointList(input.sources);

  if (sources.length === 0) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (costGrid[y][x] !== obstacleValue) {
          const idx = y * w + x;
          dist[idx] = 0;
          heap.push(idx);
        }
      }
    }
  } else {
    for (const [sx, sy] of sources) {
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
      if (costGrid[sy][sx] === obstacleValue) continue;
      const idx = sy * w + sx;
      if (dist[idx] > 0) {
        dist[idx] = 0;
        heap.push(idx);
      }
    }
  }

  const dirs = diag ? 8 : 4;
  const dxArr = diag ? DX8 : [1, 0, -1, 0];
  const dyArr = diag ? DY8 : [0, 1, 0, -1];

  while (heap.size > 0) {
    const cur = heap.pop();
    const cx = cur % w;
    const cy = (cur - cx) / w;
    const cd = dist[cur];
    for (let d = 0; d < dirs; d++) {
      const nx = cx + dxArr[d];
      const ny = cy + dyArr[d];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const cell = costGrid[ny][nx];
      if (cell === obstacleValue) continue;
      const cost = cell <= 0 ? 1 : cell;
      const stepCost = (diag && d % 2 === 1) ? cost * SQRT2 : cost;
      const nIdx = ny * w + nx;
      const nd = cd + stepCost;
      if (nd < dist[nIdx]) {
        dist[nIdx] = nd;
        parent[nIdx] = cur;
        parentDir[nIdx] = (d + 1) as number;
        heap.push(nIdx);
      }
    }
  }

  const distanceGrid = emptyGrid(w, h, -1);
  const parentGrid = emptyGrid(w, h, -1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const v = dist[idx];
      distanceGrid[y][x] = isFinite(v) ? Math.round(v * 1000) / 1000 : -1;
      parentGrid[y][x] = parentDir[idx];
    }
  }

  const pathGrid = emptyGrid(w, h, 0);
  const targets = parsePointList(input.targets);
  for (const [tx, ty] of targets) {
    if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;
    let cur = ty * w + tx;
    if (!isFinite(dist[cur])) continue;
    while (cur !== -1) {
      const x = cur % w;
      const y = (cur - x) / w;
      pathGrid[y][x] = 1;
      cur = parent[cur];
    }
  }

  return { distanceGrid, pathGrid, parentGrid };
}
