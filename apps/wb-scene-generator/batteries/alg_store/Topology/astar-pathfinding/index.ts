/**
 * A* 寻路 (A* Pathfinding)
 * Finds the shortest path on a binary grid using the A* algorithm.
 * Input: binary grid (1 = passable, 0 = blocked), start and end coordinates.
 * Output: binary grid (1 = path, 0 = background).
 * Self-contained — no external imports.
 */

export interface AstarPathfindingInput {
  grid?: number[][];
  start?: number[];
  end?: number[];
  diagonal?: boolean | number;
  seed?: number;
}

export interface AstarPathfindingOutput {
  grid: number[][];
}

class LCG {
  private s: bigint;
  constructor(seed: number) {
    this.s = BigInt(seed > 0 ? seed : 48271);
  }
  next(): bigint {
    this.s =
      (this.s * 6364136223846793005n + 1442695040888963407n) &
      0xffffffffffffffffn;
    return this.s;
  }
  intn(n: number): number {
    if (n <= 0) return 0;
    return Number((this.next() >> 33n) % BigInt(n));
  }
}

class MinHeap {
  private data: number[] = [];
  private fScores: Float64Array;
  private positions: Int32Array;
  private size = 0;

  constructor(capacity: number, fScores: Float64Array) {
    this.data = new Array(capacity);
    this.fScores = fScores;
    this.positions = new Int32Array(capacity).fill(-1);
  }

  get length(): number {
    return this.size;
  }

  push(node: number): void {
    this.data[this.size] = node;
    this.positions[node] = this.size;
    this.bubbleUp(this.size);
    this.size++;
  }

  pop(): number {
    const top = this.data[0];
    this.size--;
    if (this.size > 0) {
      this.data[0] = this.data[this.size];
      this.positions[this.data[0]] = 0;
      this.sinkDown(0);
    }
    this.positions[top] = -1;
    return top;
  }

  has(node: number): boolean {
    return this.positions[node] >= 0;
  }

  decreaseKey(node: number): void {
    const pos = this.positions[node];
    if (pos >= 0) this.bubbleUp(pos);
  }

  private bubbleUp(i: number): void {
    const d = this.data;
    const f = this.fScores;
    const p = this.positions;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (f[d[i]] >= f[d[parent]]) break;
      const tmp = d[i];
      d[i] = d[parent];
      d[parent] = tmp;
      p[d[i]] = i;
      p[d[parent]] = parent;
      i = parent;
    }
  }

  private sinkDown(i: number): void {
    const d = this.data;
    const f = this.fScores;
    const p = this.positions;
    const n = this.size;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && f[d[l]] < f[d[smallest]]) smallest = l;
      if (r < n && f[d[r]] < f[d[smallest]]) smallest = r;
      if (smallest === i) break;
      const tmp = d[i];
      d[i] = d[smallest];
      d[smallest] = tmp;
      p[d[i]] = i;
      p[d[smallest]] = smallest;
      i = smallest;
    }
  }
}

const DX4 = [1, 0, -1, 0];
const DY4 = [0, 1, 0, -1];
const DX8 = [1, 1, 0, -1, -1, -1, 0, 1];
const DY8 = [0, 1, 1, 1, 0, -1, -1, -1];
const SQRT2 = Math.SQRT2;

function parseCoord(raw: unknown): number[] | null {
  // 端口声明 number rankAny=true，但用户传入可能是多种形状：
  //   - 字符串 "x,y"
  //   - 数组 [x, y]
  //   - 嵌套数组 [[x, y]]（上游电池产出的 number rank=2 单点列表）
  //   - dispatcher 对老字符串做 rank-promotion 后包装的 ["x,y"]
  // 先逐层剥掉「长度=1 的外壳」，再分别按数组 / 字符串解析。
  while (Array.isArray(raw) && raw.length === 1) {
    raw = raw[0];
  }
  if (Array.isArray(raw)) {
    if (raw.length >= 2 && isFinite(raw[0]) && isFinite(raw[1])) {
      return [Number(raw[0]), Number(raw[1])];
    }
    return null;
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const cleaned = raw.replace(/[\[\]\s]/g, "");
    const parts = cleaned.split(",");
    if (parts.length >= 2) {
      const x = Number(parts[0]);
      const y = Number(parts[1]);
      if (isFinite(x) && isFinite(y)) return [x, y];
    }
  }
  return null;
}

/**
 * When the user-specified coordinate lands on a non-passable tile
 * (e.g. a wall in a maze), find the nearest passable tile using BFS
 * spiralling outward, so the intent is preserved as closely as possible.
 */
function snapToPassable(
  tx: number, ty: number,
  w: number, h: number,
  passable: boolean[],
): [number, number] | null {
  const cx = Math.max(0, Math.min(w - 1, Math.floor(tx)));
  const cy = Math.max(0, Math.min(h - 1, Math.floor(ty)));
  if (passable[cy * w + cx]) return [cx, cy];
  const maxR = Math.max(w, h);
  for (let r = 1; r < maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && passable[ny * w + nx]) {
          return [nx, ny];
        }
      }
    }
  }
  return null;
}

export function generateAstarPathfinding(
  input: AstarPathfindingInput,
): AstarPathfindingOutput {
  const src = input.grid;
  if (!src || src.length === 0 || !src[0] || src[0].length === 0) {
    return { grid: [] };
  }

  const h = src.length;
  const w = src[0].length;
  const diag = input.diagonal === undefined ? false : !!input.diagonal;
  const rng = new LCG(input.seed ?? 0);

  const passable: boolean[] = new Array(h * w);
  const passableList: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const ok = src[y][x] !== 0;
      passable[idx] = ok;
      if (ok) passableList.push(idx);
    }
  }

  if (passableList.length < 2) {
    return { grid: Array.from({ length: h }, () => new Array(w).fill(0)) };
  }

  let sx: number, sy: number, ex: number, ey: number;

  const startCoord = parseCoord(input.start);
  const startSnapped = startCoord
    ? snapToPassable(startCoord[0], startCoord[1], w, h, passable)
    : null;
  if (startSnapped) {
    sx = startSnapped[0];
    sy = startSnapped[1];
  } else {
    const ri = rng.intn(passableList.length);
    sx = passableList[ri] % w;
    sy = (passableList[ri] - sx) / w;
  }

  const endCoord = parseCoord(input.end);
  const endSnapped = endCoord
    ? snapToPassable(endCoord[0], endCoord[1], w, h, passable)
    : null;
  if (endSnapped) {
    ex = endSnapped[0];
    ey = endSnapped[1];
  } else {
    let ri2 = rng.intn(passableList.length);
    let attempts = 0;
    while (passableList[ri2] === sy * w + sx && attempts < 100) {
      ri2 = rng.intn(passableList.length);
      attempts++;
    }
    ex = passableList[ri2] % w;
    ey = (passableList[ri2] - ex) / w;
  }

  const startIdx = sy * w + sx;
  const endIdx = ey * w + ex;

  if (startIdx === endIdx) {
    const result = Array.from({ length: h }, () => new Array(w).fill(0));
    result[sy][sx] = 1;
    return { grid: result };
  }

  const total = h * w;
  const gScore = new Float64Array(total).fill(Infinity);
  const fScore = new Float64Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);

  const dx = diag ? DX8 : DX4;
  const dy = diag ? DY8 : DY4;
  const dirs = dx.length;

  function heuristic(idx: number): number {
    const x = idx % w;
    const y = (idx - x) / w;
    if (diag) {
      const adx = Math.abs(x - ex);
      const ady = Math.abs(y - ey);
      return Math.max(adx, ady) + (SQRT2 - 1) * Math.min(adx, ady);
    }
    return Math.abs(x - ex) + Math.abs(y - ey);
  }

  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(startIdx);

  const openSet = new MinHeap(total, fScore);
  openSet.push(startIdx);

  let found = false;

  while (openSet.length > 0) {
    const current = openSet.pop();
    if (current === endIdx) {
      found = true;
      break;
    }
    closed[current] = 1;

    const cx = current % w;
    const cy = (current - cx) / w;
    const cg = gScore[current];

    for (let d = 0; d < dirs; d++) {
      const nx = cx + dx[d];
      const ny = cy + dy[d];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (closed[nIdx] || !passable[nIdx]) continue;

      if (diag && d % 2 === 1) {
        if (!passable[cy * w + nx] || !passable[ny * w + cx]) continue;
      }

      const moveCost = (diag && d % 2 === 1) ? SQRT2 : 1;
      const tentG = cg + moveCost;

      if (tentG < gScore[nIdx]) {
        cameFrom[nIdx] = current;
        gScore[nIdx] = tentG;
        fScore[nIdx] = tentG + heuristic(nIdx);
        if (openSet.has(nIdx)) {
          openSet.decreaseKey(nIdx);
        } else {
          openSet.push(nIdx);
        }
      }
    }
  }

  const result = Array.from({ length: h }, () => new Array(w).fill(0));

  if (found) {
    let cur = endIdx;
    while (cur !== -1) {
      const x = cur % w;
      const y = (cur - x) / w;
      result[y][x] = 1;
      cur = cameFrom[cur];
    }
  }

  return { grid: result };
}
