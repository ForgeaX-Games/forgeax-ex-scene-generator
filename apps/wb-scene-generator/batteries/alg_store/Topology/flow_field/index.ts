/**
 * flow_field
 * RTS 群体寻路流场：以多目标 Dijkstra 反向计算代价图，
 * 每格指向最近邻居（最低 cost 邻格）作为流向。
 */

type Grid = number[][];

const DX8 = [1, 1, 0, -1, -1, -1, 0, 1];
const DY8 = [0, 1, 1, 1, 0, -1, -1, -1];

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
        if (isFinite(x) && isFinite(y)) out.push([Math.floor(x), Math.floor(y)]);
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
  constructor(dist: Float64Array) { this.dist = dist; }
  get size() { return this.data.length; }
  push(n: number) { this.data.push(n); this.bubbleUp(this.data.length - 1); }
  pop(): number {
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) { this.data[0] = last; this.sinkDown(0); }
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

export function flowField(input: Record<string, unknown>): Record<string, unknown> {
  const grid = input.grid as Grid | undefined;
  if (!grid || grid.length === 0 || !grid[0] || grid[0].length === 0) {
    return { costGrid: [], directionGrid: [], vectorField: [] };
  }
  const h = grid.length;
  const w = grid[0].length;
  const obstacleValue = typeof input.obstacleValue === "number" ? input.obstacleValue : 0;
  const diag = input.diagonal === undefined ? true : !!input.diagonal;
  const useWeight = !!input.useCellWeight;

  const total = w * h;
  const dist = new Float64Array(total).fill(Infinity);
  const heap = new MinHeap(dist);

  const targets = parsePointList(input.targets);
  if (targets.length === 0) {
    // 与 meta.vectorField rank=3 声明一致：返回 h × w × 2 全零向量场，避免下游
    // 形状判定崩溃。
    const emptyVF: number[][][] = Array.from({ length: h }, () =>
      Array.from({ length: w }, () => [0, 0]),
    );
    return { costGrid: emptyGrid(w, h, -1), directionGrid: emptyGrid(w, h, 0), vectorField: emptyVF };
  }
  for (const [tx, ty] of targets) {
    if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;
    if (grid[ty][tx] === obstacleValue) continue;
    const idx = ty * w + tx;
    if (dist[idx] > 0) {
      dist[idx] = 0;
      heap.push(idx);
    }
  }

  const dirs = diag ? 8 : 4;
  const dxArr = diag ? DX8 : [1, 0, -1, 0];
  const dyArr = diag ? DY8 : [0, 1, 0, -1];
  const SQRT2 = Math.SQRT2;

  while (heap.size > 0) {
    const cur = heap.pop();
    const cx = cur % w;
    const cy = (cur - cx) / w;
    const cd = dist[cur];
    for (let d = 0; d < dirs; d++) {
      const nx = cx + dxArr[d];
      const ny = cy + dyArr[d];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const cell = grid[ny][nx];
      if (cell === obstacleValue) continue;
      const cellCost = useWeight && cell > 0 ? cell : 1;
      const stepCost = (diag && d % 2 === 1) ? cellCost * SQRT2 : cellCost;
      const nd = cd + stepCost;
      const nIdx = ny * w + nx;
      if (nd < dist[nIdx]) {
        dist[nIdx] = nd;
        heap.push(nIdx);
      }
    }
  }

  const costGrid = emptyGrid(w, h, -1);
  const directionGrid = emptyGrid(w, h, 0);
  const vectorField: number[][][] = new Array(h);
  for (let y = 0; y < h; y++) vectorField[y] = new Array(w);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const cd = dist[idx];
      if (!isFinite(cd)) {
        costGrid[y][x] = -1;
        directionGrid[y][x] = 0;
        vectorField[y][x] = [0, 0];
        continue;
      }
      costGrid[y][x] = Math.round(cd * 1000) / 1000;
      if (cd === 0) {
        directionGrid[y][x] = 0;
        vectorField[y][x] = [0, 0];
        continue;
      }
      let bestD = -1;
      let bestCost = cd;
      for (let d = 0; d < dirs; d++) {
        const nx = x + dxArr[d];
        const ny = y + dyArr[d];
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const nIdx = ny * w + nx;
        if (!isFinite(dist[nIdx])) continue;
        if (dist[nIdx] < bestCost) {
          bestCost = dist[nIdx];
          bestD = d;
        }
      }
      if (bestD === -1) {
        directionGrid[y][x] = 0;
        vectorField[y][x] = [0, 0];
      } else {
        directionGrid[y][x] = bestD + 1;
        const len = (diag && bestD % 2 === 1) ? SQRT2 : 1;
        vectorField[y][x] = [dxArr[bestD] / len, dyArr[bestD] / len];
      }
    }
  }

  return { costGrid, directionGrid, vectorField };
}
