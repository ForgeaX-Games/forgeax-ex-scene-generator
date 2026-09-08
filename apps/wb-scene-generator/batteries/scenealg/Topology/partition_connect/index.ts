/**
 * partitionConnect: 在 partition + topology 上挑出最少门洞段，使所有 partition 联通。
 *
 * 输入：partition (grid[], rank=1)，topology (grid)，seed (number)
 * 输出：topology (grid) — 门洞 0/1
 *
 * 算法本体（UnionFind / collectWallSegs / openInnerDoor / innerDoorOne）
 * 完整照搬自 components/interests/building_generator 的内门步骤。
 * 与原版的差异仅在「房间标签」来源：原版从 wall 网格 4-连通 BFS 推断，
 * 本版直接读外部传入的 partition 列表（label=idx+1，非零标记），不做 exterior 检测。
 */

type Grid = number[][];

function makeLCG(seed: number): () => number {
  let s = (seed === 0 ? Date.now() : seed) >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; };
}

function shuffle<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

class UnionFind {
  private parent: number[]; private rank: number[];
  constructor(n: number) { this.parent = Array.from({ length: n }, (_, i) => i); this.rank = new Array(n).fill(0); }
  find(x: number): number { return this.parent[x] === x ? x : (this.parent[x] = this.find(this.parent[x])); }
  union(x: number, y: number): boolean {
    const px = this.find(x), py = this.find(y); if (px === py) return false;
    if (this.rank[px] < this.rank[py]) this.parent[px] = py;
    else if (this.rank[px] > this.rank[py]) this.parent[py] = px;
    else { this.parent[py] = px; this.rank[px]++; } return true;
  }
  connected(x: number, y: number): boolean { return this.find(x) === this.find(y); }
}

interface WallSeg { wallCells: number[]; roomA: number; roomB: number }

/**
 * 用 partition 标签替代原版 BFS：label[r][c] = idx+1（首张胜出），0 表示不属于任何分量。
 */
function buildLabels(partition: Grid[], rows: number, cols: number): Int32Array {
  const labels = new Int32Array(rows * cols);
  for (let i = 0; i < partition.length; i++) {
    const g = partition[i];
    const tag = i + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (g[r][c] !== 0 && labels[r * cols + c] === 0) labels[r * cols + c] = tag;
      }
    }
  }
  return labels;
}

function collectWallSegs(topology: Grid, labels: Int32Array, rows: number, cols: number): WallSeg[] {
  const segs: WallSeg[] = [];
  for (let r = 0; r < rows; r++) {
    let s = -1, rA = -1, rB = -1;
    for (let c = 0; c <= cols; c++) {
      let inner = false, a = -1, b = -1;
      if (c < cols && topology[r][c] !== 0) {
        const top = r > 0 ? labels[(r - 1) * cols + c] : 0;
        const bot = r < rows - 1 ? labels[(r + 1) * cols + c] : 0;
        if (top > 0 && bot > 0 && top !== bot) { inner = true; a = Math.min(top, bot); b = Math.max(top, bot); }
      }
      if (s !== -1 && (!inner || a !== rA || b !== rB)) {
        const cells: number[] = [];
        for (let wc = s; wc < c; wc++) cells.push(r * cols + wc);
        if (cells.length >= 2) segs.push({ wallCells: cells, roomA: rA, roomB: rB });
        s = -1;
      }
      if (inner && s === -1) { s = c; rA = a; rB = b; }
    }
  }
  for (let c = 0; c < cols; c++) {
    let s = -1, rA = -1, rB = -1;
    for (let r = 0; r <= rows; r++) {
      let inner = false, a = -1, b = -1;
      if (r < rows && topology[r][c] !== 0) {
        const left = c > 0 ? labels[r * cols + c - 1] : 0;
        const right = c < cols - 1 ? labels[r * cols + c + 1] : 0;
        if (left > 0 && right > 0 && left !== right) { inner = true; a = Math.min(left, right); b = Math.max(left, right); }
      }
      if (s !== -1 && (!inner || a !== rA || b !== rB)) {
        const cells: number[] = [];
        for (let wr = s; wr < r; wr++) cells.push(wr * cols + c);
        if (cells.length >= 2) segs.push({ wallCells: cells, roomA: rA, roomB: rB });
        s = -1;
      }
      if (inner && s === -1) { s = r; rA = a; rB = b; }
    }
  }
  return segs;
}

function openInnerDoor(seg: WallSeg, doorG: Grid, cols: number, rand: () => number): void {
  const cells = seg.wallCells, len = cells.length;
  const minW = 2, maxW = 4, maxA = Math.min(maxW, len - 2);
  let start: number, width: number;
  if (maxA < minW) { width = Math.min(minW, len); start = Math.floor((len - width) / 2); }
  else { width = minW + Math.floor(rand() * (maxA - minW + 1)); start = 1 + Math.floor(rand() * (len - width - 1)); }
  for (let i = start; i < start + width; i++) {
    const k = cells[i]; doorG[Math.floor(k / cols)][k % cols] = 1;
  }
}

function sameShape(a: Grid, b: Grid): boolean {
  return a.length === b.length && (a[0]?.length ?? 0) === (b[0]?.length ?? 0);
}

export function partitionConnect(input: Record<string, unknown>): Record<string, unknown> {
  const partition = input.partition as Grid[] | undefined;
  const topology = input.topology as Grid | undefined;
  if (!partition || partition.length === 0) {
    return { error: 'partition is required and must be non-empty' };
  }
  if (!topology || topology.length === 0 || (topology[0]?.length ?? 0) === 0) {
    return { error: 'topology is required' };
  }
  for (const g of partition) {
    if (!sameShape(topology, g)) return { error: 'all partition grids must match topology shape' };
  }
  const rows = topology.length, cols = topology[0].length;
  const seedRaw = typeof input.seed === 'number' ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;
  const rand = makeLCG(seed);

  const doorGrid: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  if (partition.length <= 1) return { topology: doorGrid };

  const labels = buildLabels(partition, rows, cols);
  const segs = collectWallSegs(topology, labels, rows, cols);
  if (segs.length === 0) return { topology: doorGrid };

  const uf = new UnionFind(partition.length);
  shuffle(segs, rand);
  const chosen: WallSeg[] = [];
  for (const seg of segs) {
    const ia = seg.roomA - 1, ib = seg.roomB - 1;
    if (ia < 0 || ib < 0 || ia >= partition.length || ib >= partition.length) continue;
    if (!uf.connected(ia, ib)) { uf.union(ia, ib); chosen.push(seg); }
  }
  for (const seg of chosen) openInnerDoor(seg, doorGrid, cols, rand);
  return { topology: doorGrid };
}
