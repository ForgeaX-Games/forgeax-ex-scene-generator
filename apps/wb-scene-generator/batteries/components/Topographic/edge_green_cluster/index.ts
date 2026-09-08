/**
 * edge_green_cluster: 边缘绿簇
 *
 * 在指定区域（targetValue 掩码）的边缘处生成若干形状不规则的「绿簇」，每簇是一团
 * 从边缘种子点向区域内部有机生长的连通像素块，粘附在区域内缘上。常用于在地块/水体
 * 边缘点缀灌木、苔藓、藻类等自然碎绿。
 *
 * 流程：① Moore 追踪区域外轮廓，沿轮廓等距 + 抖动取 count 个边缘种子；
 *       ② 每个种子用「欧氏距离 + FBM 噪声」优先级 BFS 在区域内部长出 ~clusterSize 个
 *          像素的不规则团块（irregularity 控制形状破碎度，占用图避免相互重叠）；
 *       ③ 把所有簇写入与输入同形状的输出网格（背景 0，簇 = outputValue）。
 *
 * DataTree 数据格式：输入 inputGrid 与输出 outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 */

import { traceBoundaryContour } from "./contour";

type Grid = number[][];
type RngFn = () => number;

function parseGrid(raw: unknown): Grid | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  if (Array.isArray(raw[0]) && typeof (raw[0] as unknown[])[0] === "number") {
    return raw as Grid;
  }
  return null;
}

function createRng(seed: number): RngFn {
  let s = (seed & 0xffffffff) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

// —— FBM 噪声（簇形状的有机抖动）——

function hash2D(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 43758.5453) * 43758.5453;
  return n - Math.floor(n);
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = smoothstep(fx), uy = smoothstep(fy);
  const a = hash2D(ix, iy, seed);
  const b = hash2D(ix + 1, iy, seed);
  const c = hash2D(ix, iy + 1, seed);
  const d = hash2D(ix + 1, iy + 1, seed);
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}

function fbm(x: number, y: number, seed: number): number {
  let value = 0, amplitude = 0.5, frequency = 1, total = 0;
  for (let i = 0; i < 3; i++) {
    value += valueNoise(x * frequency, y * frequency, seed + i * 17) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.1;
  }
  return value / total;
}

// —— 优先队列（最小堆）——

interface HeapNode { score: number; x: number; y: number; }

class MinHeap {
  private data: HeapNode[] = [];
  push(node: HeapNode): void { this.data.push(node); this.bubbleUp(this.data.length - 1); }
  pop(): HeapNode | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) { this.data[0] = last; this.bubbleDown(0); }
    return top;
  }
  get size(): number { return this.data.length; }
  private bubbleUp(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].score > this.data[i].score) {
        [this.data[p], this.data[i]] = [this.data[i], this.data[p]]; i = p;
      } else break;
    }
  }
  private bubbleDown(i: number): void {
    const n = this.data.length;
    while (true) {
      const l = i * 2 + 1, r = i * 2 + 2;
      let m = i;
      if (l < n && this.data[l].score < this.data[m].score) m = l;
      if (r < n && this.data[r].score < this.data[m].score) m = r;
      if (m !== i) { [this.data[i], this.data[m]] = [this.data[m], this.data[i]]; i = m; } else break;
    }
  }
}

const NOISE_SCALE = 0.22;

/**
 * 从边缘种子点出发，在区域内部（grid===targetValue）按「欧氏距离 + FBM 噪声」
 * 优先级 BFS 长出约 targetArea 个连通像素的不规则团块；jitter 越大形状越破碎。
 *
 * 每个簇独立生长、只受区域掩码约束（不阻塞于其它簇），从而 clusterSize 能被
 * 如实兑现；相邻簇允许相互重叠/连片（写出时取并集）。
 */
function growCluster(
  grid: Grid,
  targetValue: number,
  sy: number,
  sx: number,
  targetArea: number,
  jitter: number,
  noiseSeed: number,
): Array<[number, number]> {
  const rows = grid.length, cols = grid[0].length;
  const cells: Array<[number, number]> = [];
  if (targetArea <= 0) return cells;
  if (sy < 0 || sy >= rows || sx < 0 || sx >= cols) return cells;
  if (grid[sy][sx] !== targetValue) return cells;

  const visited: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const heap = new MinHeap();
  heap.push({ score: 0, x: sx, y: sy });
  visited[sy][sx] = true;
  const dirs4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let added = 0;

  while (added < targetArea && heap.size > 0) {
    const node = heap.pop()!;
    cells.push([node.y, node.x]);
    added++;
    for (const [dx, dy] of dirs4) {
      const nx = node.x + dx, ny = node.y + dy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      if (visited[ny][nx]) continue;
      if (grid[ny][nx] !== targetValue) continue;
      visited[ny][nx] = true;
      const dist = Math.hypot(nx - sx, ny - sy);
      const noise = fbm(nx * NOISE_SCALE, ny * NOISE_SCALE, noiseSeed) * jitter;
      heap.push({ score: dist + noise, x: nx, y: ny });
    }
  }
  return cells;
}

export function edgeGreenCluster(input: Record<string, unknown>): Record<string, unknown> {
  const grid = parseGrid(input.inputGrid);
  if (!grid) return { error: "inputGrid is required" };
  if (grid.length === 0 || grid[0].length === 0) return { error: "inputGrid is empty" };

  const rows = grid.length, cols = grid[0].length;
  const targetValue = typeof input.targetValue === "number" ? Math.round(input.targetValue) : 1;
  const count = typeof input.count === "number" ? Math.max(0, Math.round(input.count)) : 12;
  const clusterSize = typeof input.clusterSize === "number" ? Math.max(1, Math.round(input.clusterSize)) : 18;
  const sizeVariance = typeof input.sizeVariance === "number" ? Math.min(1, Math.max(0, input.sizeVariance)) : 0.4;
  const irregularity = typeof input.irregularity === "number" ? Math.min(1, Math.max(0, input.irregularity)) : 0.6;
  const outputValue = typeof input.outputValue === "number" ? Math.round(input.outputValue) : 1;
  const rawSeed = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = rawSeed === 0 ? (Date.now() & 0x7fffffff) : rawSeed;

  const out: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  if (count === 0) return { outputGrid: out };

  // 沿区域外轮廓等距 + 抖动取边缘种子
  const contour = traceBoundaryContour(grid, targetValue); // [x, y]
  if (contour.length === 0) return { outputGrid: out };

  const rng = createRng(baseSeed);
  const n = contour.length;
  const step = n / count;
  // irregularity → 噪声抖动强度；越大簇形越破碎
  const jitter = 1 + irregularity * 7;

  for (let i = 0; i < count; i++) {
    const base = i * step;
    const off = (rng() - 0.5) * step * 0.6; // 沿轮廓的位置抖动
    let idx = Math.round(base + off);
    idx = ((idx % n) + n) % n;
    const [x, y] = contour[idx];

    const sizeFactor = 1 + (rng() * 2 - 1) * sizeVariance;
    const size = Math.max(1, Math.round(clusterSize * sizeFactor));
    const cells = growCluster(grid, targetValue, y, x, size, jitter, baseSeed + i * 100003);
    for (const [r, c] of cells) out[r][c] = outputValue;
  }

  return { outputGrid: out };
}
