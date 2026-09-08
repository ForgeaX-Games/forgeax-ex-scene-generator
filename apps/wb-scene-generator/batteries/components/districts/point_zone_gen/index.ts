/**
 * point_zone_gen: 点生区域
 *
 * DataTree 数据格式：输入 inputGrid 与输出 outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 *
 * 输入：
 *   inputGrid (grid)   — 单张输入网格，仅用于确定输出尺寸与起始 ID
 *   regions   (string) — 区域定义 JSON 字符串：[[x, y, area, height], ...]
 *   seed      (number) — 随机种子，0=当前时间
 *
 * 输出：
 *   outputGrid     (grid)  — 单张多值网格，每个区域一个递增 id
 *   outputNameList (array) — [{id, name, type, height}]，与网格中的 id 一一对应
 *
 * 算法（移植自 zone_nesting）：
 *   1. 从种子点出发做"欧氏距离 + FBM 噪声"加权优先级 BFS，生长出
 *      恰好 area 个连通像素的有机区域。
 *   2. 用 Moore 邻域追踪外轮廓，应用闭合高斯样条平滑。
 *   3. 重新光栅化得到边界平滑的单值网格。
 */

import { gaussianFilterClosed, type Point } from "./algorithm";
import { traceBoundaryContour, rasterizeFilledContour } from "./contour";

type Grid = number[][];

interface NameEntry {
  id: number;
  name: string;
  type: string;
  height: number;
}

interface RegionSpec {
  x: number;
  y: number;
  area: number;
  height: number;
}

const TARGET_VALUE = 1;
const BACKGROUND_VALUE = 0;
const SPLINE_SMOOTHNESS = 4;
const SEED_OFFSET = 999983;
const NOISE_SCALE = 0.18;
const NOISE_JITTER = 4;

// ---------- FBM noise (used as BFS priority jitter) ----------

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

// ---------- Min-heap for priority BFS ----------

interface HeapNode {
  score: number;
  x: number;
  y: number;
}

class MinHeap {
  private data: HeapNode[] = [];

  push(node: HeapNode): void {
    this.data.push(node);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): HeapNode | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  get size(): number {
    return this.data.length;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.data[p].score > this.data[i].score) {
        [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
        i = p;
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
      if (m !== i) {
        [this.data[i], this.data[m]] = [this.data[m], this.data[i]];
        i = m;
      } else break;
    }
  }
}

// ---------- BFS+noise growth ----------

/**
 * 从种子点出发，按"欧氏距离 + FBM 噪声"作为优先级 BFS 生长，
 * 直到收集到恰好 targetArea 个 4-连通像素，得到形状自然的有机区域。
 * 当种子点在网格外时自动钳制到最近的边界格点。
 */
function growOrganicRegion(
  rows: number,
  cols: number,
  pointX: number,
  pointY: number,
  targetArea: number,
  noiseSeed: number,
): boolean[][] {
  const inRegion: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  if (targetArea <= 0) return inRegion;

  const sx = Math.max(0, Math.min(cols - 1, Math.round(pointX)));
  const sy = Math.max(0, Math.min(rows - 1, Math.round(pointY)));

  const visited: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const heap = new MinHeap();
  heap.push({ score: 0, x: sx, y: sy });
  visited[sy][sx] = true;

  const dirs4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let added = 0;

  while (added < targetArea && heap.size > 0) {
    const node = heap.pop()!;
    inRegion[node.y][node.x] = true;
    added++;

    for (const [dx, dy] of dirs4) {
      const nx = node.x + dx, ny = node.y + dy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      if (visited[ny][nx]) continue;
      visited[ny][nx] = true;
      const ddx = nx - sx, ddy = ny - sy;
      const dist = Math.hypot(ddx, ddy);
      const noise = fbm(nx * NOISE_SCALE, ny * NOISE_SCALE, noiseSeed) * NOISE_JITTER;
      heap.push({ score: dist + noise, x: nx, y: ny });
    }
  }

  return inRegion;
}

// ---------- Spline smoothing on a boolean region (port from zone_nesting) ----------

function applySplineSmoothing(inRegion: boolean[][]): boolean[][] {
  if (inRegion.length === 0) return inRegion;

  const intGrid: Grid = inRegion.map(row => row.map(v => v ? TARGET_VALUE : BACKGROUND_VALUE));

  const contour = traceBoundaryContour(intGrid, TARGET_VALUE);
  if (contour.length < 6) return inRegion;

  const splined: Point[] = gaussianFilterClosed(contour, SPLINE_SMOOTHNESS);
  if (splined.length < 3) return inRegion;

  const smoothed = rasterizeFilledContour(intGrid, splined, TARGET_VALUE, BACKGROUND_VALUE);
  return smoothed.map(row => row.map(v => v === TARGET_VALUE));
}

// ---------- Parsers ----------

/** 判断 v 是单张网格 number[][] */
function isGrid(v: unknown): v is Grid {
  if (!Array.isArray(v) || v.length === 0) return false;
  const first = (v as unknown[])[0];
  if (!Array.isArray(first) || (first as unknown[]).length === 0) return false;
  return typeof (first as unknown[])[0] === "number";
}

/** 解析区域定义：JSON 字符串或数组，每项为 [x, y, area, height] */
function parseRegions(raw: unknown): RegionSpec[] {
  if (!raw) return [];
  let arr: unknown = raw;
  if (typeof raw === "string") {
    if (raw.trim() === "") return [];
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  return (arr as unknown[]).map((item) => {
    if (!Array.isArray(item)) return { x: 0, y: 0, area: 0, height: 0 };
    const [x, y, area, height] = item as [unknown, unknown, unknown, unknown];
    return {
      x: typeof x === "number" ? x : 0,
      y: typeof y === "number" ? y : 0,
      area: typeof area === "number" ? Math.max(0, Math.round(area)) : 0,
      height: typeof height === "number" ? height : 0,
    };
  });
}

function gridMax(g: Grid): number {
  let max = 0;
  for (const row of g) {
    for (const v of row) if (v > max) max = v;
  }
  return max;
}

// ---------- Main entry ----------

export function pointZoneGen(input: Record<string, unknown>): Record<string, unknown> {
  const baseGrid = input.inputGrid;
  if (!isGrid(baseGrid)) {
    return { error: "inputGrid is required (number[][])" };
  }

  const rows = baseGrid.length;
  const cols = baseGrid[0].length;

  const regions = parseRegions(input.regions);
  const baseID = gridMax(baseGrid) + 1;

  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;

  // 单张多值网格：每个区域一个递增 id（重叠处后写入者覆盖）
  const outputGrid: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const outputNameList: NameEntry[] = [];

  regions.forEach((spec, i) => {
    const id = baseID + i;
    const effectiveSeed = baseSeed + i * SEED_OFFSET;

    const region = growOrganicRegion(rows, cols, spec.x, spec.y, spec.area, effectiveSeed);
    const smoothed = applySplineSmoothing(region);

    let painted = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (smoothed[r][c]) { outputGrid[r][c] = id; painted = true; }
      }
    }

    if (painted) {
      outputNameList.push({
        id,
        name: `区域 ${i + 1}`,
        type: "tile",
        height: spec.height,
      });
    }
  });

  return { outputGrid, outputNameList };
}
