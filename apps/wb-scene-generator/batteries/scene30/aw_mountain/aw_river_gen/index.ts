/**
 * awRiverGen: 草地区域自适应宽度河流生成器
 * 算法：BFS 距离场 → 带噪声扰动的 Dijkstra 路径 → 高斯宽度平滑 → SDF 渲染
 *
 * 输入：terrainGrid (grid) — 地块分类网格；targetBiome (number) — 河流所在地块类型
 *       widthScale (number) — 宽度缩放；noiseStrength (number) — 蜿蜒强度；seed (number)
 * 输出：riverMask (grid) — 河流格子为 1，其余为 0
 */

// ── 工具 ────────────────────────────────────────────────────────────────────

class SeededRandom {
  private s: number;
  constructor(seed: number) {
    this.s = seed === 0 ? Date.now() : Math.abs(Math.round(seed));
    for (let i = 0; i < 8; i++) this.next();
  }
  next(): number {
    this.s = (this.s * 1664525 + 1013904223) & 0xffffffff;
    return (this.s >>> 0) / 0xffffffff;
  }
}

/** 基于坐标的确定性噪声，用于 Dijkstra 路径扰动 */
function cellNoise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

// ── 距离变换（多源 BFS） ─────────────────────────────────────────────────────

/** 返回每格到最近非目标地块的距离；非目标格子距离为 0 */
function computeDistField(grid: number[][], targetBiome: number): number[][] {
  const rows = grid.length;
  const cols = grid[0].length;
  const dist: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  const queue: number[] = []; // encoded = y * cols + x

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (grid[y][x] !== targetBiome) {
        dist[y][x] = 0;
        queue.push(y * cols + x);
      }
    }
  }

  const DY = [-1, 1, 0, 0];
  const DX = [0, 0, -1, 1];
  let head = 0;
  while (head < queue.length) {
    const enc = queue[head++];
    const cy = Math.floor(enc / cols);
    const cx = enc % cols;
    const d = dist[cy][cx];
    for (let i = 0; i < 4; i++) {
      const ny = cy + DY[i];
      const nx = cx + DX[i];
      if (ny < 0 || ny >= rows || nx < 0 || nx >= cols) continue;
      if (dist[ny][nx] === -1) {
        dist[ny][nx] = d + 1;
        queue.push(ny * cols + nx);
      }
    }
  }
  return dist;
}

// ── 最小堆（Dijkstra 用） ────────────────────────────────────────────────────

class MinHeap {
  private data: [number, number][] = [];

  push(cost: number, pos: number): void {
    this.data.push([cost, pos]);
    let i = this.data.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p][0] <= this.data[i][0]) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }

  pop(): [number, number] | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      let i = 0;
      const n = this.data.length;
      while (true) {
        let s = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < n && this.data[l][0] < this.data[s][0]) s = l;
        if (r < n && this.data[r][0] < this.data[s][0]) s = r;
        if (s === i) break;
        [this.data[i], this.data[s]] = [this.data[s], this.data[i]];
        i = s;
      }
    }
    return top;
  }

  get size(): number { return this.data.length; }
}

// ── Dijkstra 路径寻找 ────────────────────────────────────────────────────────

/**
 * 在目标地块内（distField > 0）寻找从 start 到 end 的最优路径。
 * 代价函数：偏好高距离场值的格子（宽阔区中心），叠加噪声实现蜿蜒效果。
 */
function findPath(
  distField: number[][],
  startEnc: number,
  endEnc: number,
  maxDist: number,
  noiseStrength: number,
  noiseSeed: number,
  rows: number,
  cols: number,
): number[] | null {
  const INF = 1e12;
  const costs = new Float64Array(rows * cols).fill(INF);
  const prev = new Int32Array(rows * cols).fill(-1);

  costs[startEnc] = 0;
  const heap = new MinHeap();
  heap.push(0, startEnc);

  // 8 方向移动：4 正交 + 4 斜向，斜向代价乘 √2 避免走"锯齿对角线"
  const DY    = [-1,  1,  0,  0, -1, -1,  1,  1];
  const DX    = [ 0,  0, -1,  1, -1,  1, -1,  1];
  const DCOST = [ 1,  1,  1,  1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

  while (heap.size > 0) {
    const item = heap.pop()!;
    const [cost, enc] = item;
    if (enc === endEnc) break;
    if (cost > costs[enc]) continue; // stale entry

    const cy = Math.floor(enc / cols);
    const cx = enc % cols;

    for (let i = 0; i < 8; i++) {
      const ny = cy + DY[i];
      const nx = cx + DX[i];
      if (ny < 0 || ny >= rows || nx < 0 || nx >= cols) continue;
      const nd = distField[ny][nx];
      if (nd <= 0) continue; // non-target biome: blocked

      // 代价：距离场值越大越便宜（鼓励走宽阔中心），加噪声扰动实现蜿蜒，乘方向系数
      const moveCost = DCOST[i] * ((maxDist - nd + 1) + cellNoise(nx, ny, noiseSeed) * noiseStrength * maxDist);
      const nenc = ny * cols + nx;
      const newCost = cost + moveCost;
      if (newCost < costs[nenc]) {
        costs[nenc] = newCost;
        prev[nenc] = enc;
        heap.push(newCost, nenc);
      }
    }
  }

  if (prev[endEnc] === -1 && startEnc !== endEnc) return null;

  const path: number[] = [];
  let cur = endEnc;
  while (cur !== -1) {
    path.push(cur);
    cur = prev[cur];
  }
  path.reverse();
  return path;
}

// ── 1D 高斯宽度平滑 ─────────────────────────────────────────────────────────

function gaussianSmooth(values: number[], sigma: number): number[] {
  const radius = Math.ceil(sigma * 2.5);
  const kernel: number[] = [];
  let ksum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(w);
    ksum += w;
  }
  const norm = kernel.map(w => w / ksum);
  return values.map((_, idx) => {
    let v = 0;
    for (let j = 0; j < norm.length; j++) {
      const src = Math.max(0, Math.min(values.length - 1, idx + j - radius));
      v += norm[j] * values[src];
    }
    return v;
  });
}

// ── 路径坐标平滑（移动均值，消除残余锯齿） ────────────────────────────────────

function smoothPath(
  path: number[],
  cols: number,
  sigma: number,
): { y: number; x: number }[] {
  const pts = path.map(enc => ({ y: Math.floor(enc / cols), x: enc % cols }));
  const radius = Math.ceil(sigma * 2);
  const kernel: number[] = [];
  let ksum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(w); ksum += w;
  }
  const norm = kernel.map(w => w / ksum);
  return pts.map((_, idx) => {
    let sy = 0, sx = 0;
    for (let j = 0; j < norm.length; j++) {
      const src = Math.max(0, Math.min(pts.length - 1, idx + j - radius));
      sy += norm[j] * pts[src].y;
      sx += norm[j] * pts[src].x;
    }
    return { y: sy, x: sx };
  });
}

// ── SDF 圆形渲染 ──────────────────────────────────────────────────────────────

function renderRiver(
  rows: number,
  cols: number,
  smoothedPts: { y: number; x: number }[],
  widths: number[],
): number[][] {
  const mask: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < smoothedPts.length; i++) {
    const cy = smoothedPts[i].y;
    const cx = smoothedPts[i].x;
    const r = widths[i];
    const r2 = r * r;
    const minY = Math.max(0, Math.floor(cy - r));
    const maxY = Math.min(rows - 1, Math.ceil(cy + r));
    const minX = Math.max(0, Math.floor(cx - r));
    const maxX = Math.min(cols - 1, Math.ceil(cx + r));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if ((y - cy) ** 2 + (x - cx) ** 2 <= r2) {
          mask[y][x] = 1;
        }
      }
    }
  }
  return mask;
}

// ── 单条河流生成（内部复用） ─────────────────────────────────────────────────

/** 按指定轴方向将候选点分成两组，返回 [groupA, groupB] */
function splitCandidates(
  candidates: { enc: number; dist: number }[],
  rows: number,
  cols: number,
  axis: "y" | "x" | "diag",
): [{ enc: number; dist: number }[], { enc: number; dist: number }[]] {
  let a: typeof candidates, b: typeof candidates;
  if (axis === "y") {
    const mid = rows / 2;
    a = candidates.filter(c => Math.floor(c.enc / cols) < mid);
    b = candidates.filter(c => Math.floor(c.enc / cols) >= mid);
  } else if (axis === "x") {
    const mid = cols / 2;
    a = candidates.filter(c => c.enc % cols < mid);
    b = candidates.filter(c => c.enc % cols >= mid);
  } else {
    // 对角线分割（左上 vs 右下）
    a = candidates.filter(c => (Math.floor(c.enc / cols) / rows) + (c.enc % cols / cols) < 1);
    b = candidates.filter(c => (Math.floor(c.enc / cols) / rows) + (c.enc % cols / cols) >= 1);
  }
  if (a.length === 0 || b.length === 0) {
    const half = Math.floor(candidates.length / 2);
    return [candidates.slice(0, half), candidates.slice(half)];
  }
  return [a, b];
}

function generateOneRiver(
  distField: number[][],
  candidates: { enc: number; dist: number }[],
  maxDist: number,
  rows: number,
  cols: number,
  widthScale: number,
  noiseStrength: number,
  smoothSigma: number,
  subSeed: number,
  axis: "y" | "x" | "diag",
): number[][] | null {
  const rng = new SeededRandom(subSeed);
  const [groupA, groupB] = splitCandidates(candidates, rows, cols, axis);

  // 从 biome 边缘格（低距离场值）选起终点，使河流穿越整个区域而非绕中心打转。
  // 取距离场值 ≤ 25% maxDist 的边缘候选，随机选其中一个。
  // 若边缘格不足则回退到全组。
  const pickBoundaryFrom = (group: typeof candidates) => {
    const sorted = [...group].sort((a, b) => a.dist - b.dist);
    const cutoff = Math.max(1, Math.ceil(maxDist * 0.25));
    const pool = sorted.filter(c => c.dist <= cutoff);
    const use = pool.length >= 1 ? pool : sorted;
    return use[Math.floor(rng.next() * Math.min(use.length, 12))].enc;
  };

  const startEnc = pickBoundaryFrom(groupA);
  const endEnc   = pickBoundaryFrom(groupB);
  if (endEnc === startEnc) return null;

  const path = findPath(distField, startEnc, endEnc, maxDist, noiseStrength, subSeed * 7 + 13, rows, cols);
  if (!path || path.length < 2) return null;

  const rawWidths = path.map(enc =>
    Math.max(1, distField[Math.floor(enc / cols)][enc % cols] * widthScale)
  );
  const smoothedWidths = gaussianSmooth(rawWidths, smoothSigma);
  // 对路径坐标本身做高斯平滑，消除 8 方向 Dijkstra 的残余锯齿
  const smoothedPts = smoothPath(path, cols, smoothSigma);
  return renderRiver(rows, cols, smoothedPts, smoothedWidths);
}

// ── 输入解析：兼容单张网格和网格列表（取第一张）────────────────────────────

function extractGrid(v: unknown): number[][] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const first = (v as unknown[])[0];
  if (!Array.isArray(first) || (first as unknown[]).length === 0) return null;
  // 单张网格：first[0] 是数字
  if (typeof (first as unknown[])[0] === "number") return v as number[][];
  // 网格列表：first[0] 是数组 → 取第一张
  if (Array.isArray((first as unknown[])[0])) {
    const inner = (v as unknown[][][])[0];
    if (Array.isArray(inner) && inner.length > 0 && typeof (inner[0] as unknown[])[0] === "number") {
      return inner as number[][];
    }
  }
  return null;
}

// ── 主导出函数 ────────────────────────────────────────────────────────────────

const EMPTY_MASK: number[][] = [];

export function awRiverGen(input: Record<string, unknown>): Record<string, unknown> {
  const terrainGrid = extractGrid(input.terrainGrid);
  if (!terrainGrid) {
    return { riverMask: EMPTY_MASK };
  }

  const rows = terrainGrid.length;
  const cols = terrainGrid[0]?.length ?? 0;
  if (cols === 0) {
    return { riverMask: EMPTY_MASK };
  }

  const targetBiome   = typeof input.targetBiome   === "number" ? input.targetBiome   : 3;
  const count         = Math.max(1, Math.min(6, Math.round(typeof input.count === "number" ? input.count : 1)));
  const widthScale    = typeof input.widthScale     === "number" ? input.widthScale     : 0.55;
  const noiseStrength = typeof input.noiseStrength  === "number" ? input.noiseStrength  : 0.45;
  const smoothSigma   = typeof input.smoothSigma    === "number" ? input.smoothSigma    : 8;
  const seed          = typeof input.seed           === "number" ? input.seed           : 42;

  // 1. 距离场（所有河流共享同一张）
  const distField = computeDistField(terrainGrid, targetBiome);
  let maxDist = 0;
  for (const row of distField) for (const v of row) if (v > maxDist) maxDist = v;
  if (maxDist === 0) {
    return { riverMask: EMPTY_MASK };
  }

  // 2. 候选格子（按距离场值降序）
  const candidates: { enc: number; dist: number }[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (distField[y][x] > 0) candidates.push({ enc: y * cols + x, dist: distField[y][x] });
    }
  }
  if (candidates.length < 2) {
    return { riverMask: EMPTY_MASK };
  }
  candidates.sort((a, b) => b.dist - a.dist);

  // 3. 为每条河流选择不同的空间分割轴，避免走相同路线
  const axes: ("y" | "x" | "diag")[] = ["y", "x", "diag", "y", "x", "diag"];

  // 4. 合并所有河流掩码（OR 合并：任意一条覆盖的格子都标为 1）
  const riverMask: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  let generated = 0;

  for (let i = 0; i < count; i++) {
    const subSeed = seed + i * 1000 + i * 37;
    const mask = generateOneRiver(
      distField, candidates, maxDist, rows, cols,
      widthScale, noiseStrength, smoothSigma,
      subSeed, axes[i % axes.length],
    );
    if (mask) {
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++)
          if (mask[y][x]) riverMask[y][x] = 1;
      generated++;
    }
  }

  if (generated === 0) {
    return { riverMask: EMPTY_MASK };
  }

  return { riverMask };
}
