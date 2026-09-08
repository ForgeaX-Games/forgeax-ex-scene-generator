/**
 * hillContourGenerate
 *
 * 生成策略：
 *   在输入掩码的非零区域内，以高斯距离场为主体构建高度场，使等高线严格
 *   一层套一层（同心状）。具体步骤：
 *
 *   1. 计算每个非零格子到最近山峰的加权距离（多峰取 soft-max 融合）
 *   2. 在距离场上叠加轻微的 Value Noise 扰动（noiseAmount 控制），
 *      使等高线边缘呈有机感而非完美圆形
 *   3. 对非零区域的高度值做等面积重映射（分位数拉伸），
 *      使每层等高带的格子数相近
 *   4. 按层号生成多值网格（外层序号小，内层序号大）
 *   5. 内置后处理：合并所有层 → 填孔洞 → 删孤立块 → 归并空白
 *   6. 把互斥的等高带累积成**实心嵌套面**：第 i 层 = 所有高度层 ≥ i 的格子
 *
 *   山峰位置/半径/噪声频率都按输入掩码的包围盒归一化，后处理只在掩码内进行——
 *   输出严格落在输入形状内，不会外溢到掩码之外的空白区域。
 *
 *   为什么每层要是实心面而不是条带：一层 = 一个 scene 子节点，节点的体素只有自己那一层。
 *   若第 i 层只含「高度恰好为 i」的环带，隐藏它就会在山顶留下一个洞、直接露到地面；
 *   累积成实心面后，山顶那片格子在每一层里都有体素（各自的 z 不同），隐藏最上层正好
 *   露出下一层的顶面，差一个悬崖高度。要互斥条带请用 strip_cliff_generate。
 *
 * DataTree 数据格式：输入 inputGrid 与输出 outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 *
 * 输入：
 *   inputGrid     (grid)   — 输入掩码网格，仅对非 0 格子生成等高线
 *   contourLevels (number) — 等高线层数（默认 6）
 *   hillCount     (number) — 山头数量（默认 1）
 *   roundness     (number) — 圆度 0~1（默认 0.85）
 *   peakRadius    (number) — 山包半径 0~1（默认 0.35）
 *   noiseAmount   (number) — 边缘扰动量（默认 0.12）
 *   minHoleSize   (number) — 后处理：最大孔洞面积（默认 20）
 *   minIslandSize (number) — 后处理：最小岛屿面积（默认 8）
 *   peakPosition  (number) — 九宫格位置 1~9（键盘数字键布局），0=随机（默认 0）
 *   seed          (number) — 随机种子（默认 0）
 *
 * 输出：
 *   outputGrids    (grid,   access:list)   — 每层一张**实心嵌套面**：第 i 张含所有高度层 ≥ i 的格子（格值 = i）
 *   outputLevels   (number, access:list)   — 与 outputGrids 一一对应的层顶高度 i-1，接 grid2node.z
 *   outputGrid     (grid,   access:item)   — 单张多值网格（每格 = 其等高带层序号），供预览与求剩余空地
 *   outputNameList (array,  access:item)   — 各层名称清单
 */

type Grid = number[][];
type NameEntry = { id: number; name: string; type: string };
type Point = { x: number; y: number };
/** 掩码非零区域的包围盒；所有归一化坐标都相对它，而非整张网格 */
type BBox = { minR: number; maxR: number; minC: number; maxC: number };

/** 判断 v 是单张网格 number[][] */
function isGrid(v: unknown): v is Grid {
  if (!Array.isArray(v) || v.length === 0) return false;
  const first = (v as unknown[])[0];
  if (!Array.isArray(first) || (first as unknown[]).length === 0) return false;
  return typeof (first as unknown[])[0] === "number";
}

// ─── PRNG ─────────────────────────────────────────────────────────────────────

class SeededRandom {
  private s: number;

  constructor(seed: number) {
    this.s = seed === 0 ? Date.now() >>> 0 : (Math.abs(Math.round(seed)) >>> 0) || 1;
    for (let i = 0; i < 8; i++) this.next();
  }

  next(): number {
    this.s = (this.s * 1664525 + 1013904223) >>> 0;
    return this.s / 0xffffffff;
  }
}

// ─── 数学工具 ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function fade(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

// ─── Value Noise（仅用于轻微边缘扰动）────────────────────────────────────────

function hash2(ix: number, iy: number, seed: number): number {
  let n = (ix * 374761393 + iy * 668265263 + seed * 69069) | 0;
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 0xffffffff;
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  return lerp(
    lerp(hash2(x0, y0, seed), hash2(x0 + 1, y0, seed), tx),
    lerp(hash2(x0, y0 + 1, seed), hash2(x0 + 1, y0 + 1, seed), tx),
    ty
  );
}

// ─── 九宫格位置映射 ────────────────────────────────────────────────────────────

/**
 * 将九宫格编号（1-9，键盘数字键布局）转换为归一化坐标。
 * 布局：
 *   7(左上) 8(上中) 9(右上)
 *   4(左中) 5(正中) 6(右中)
 *   1(左下) 2(下中) 3(右下)
 *
 * 边距 margin 使峰不贴近区域边缘。
 */
function numpadToNormalized(pos: number, margin = 0.2): Point {
  const col = ((pos - 1) % 3);        // 0=左 1=中 2=右
  const row = 2 - Math.floor((pos - 1) / 3); // 0=下 1=中 2=上（y 轴向下）
  const x = margin + col * (1 - 2 * margin) / 2;
  const y = margin + row * (1 - 2 * margin) / 2;
  return { x, y };
}

// ─── 山峰位置采样 ──────────────────────────────────────────────────────────────

/** 把格子坐标归一化到掩码包围盒的 [0,1]² */
function normalizeInBox(r: number, c: number, box: BBox): Point {
  const h = box.maxR - box.minR;
  const w = box.maxC - box.minC;
  return {
    x: w > 0 ? (c - box.minC) / w : 0.5,
    y: h > 0 ? (r - box.minR) / h : 0.5,
  };
}

/** 把归一化坐标吸附到最近的掩码非零格，避免凹形/L 形掩码上山峰落在形状之外 */
function snapToMask(p: Point, nonZeroCells: [number, number][], box: BBox): Point {
  let best = p;
  let bestD = Infinity;
  for (const [r, c] of nonZeroCells) {
    const q = normalizeInBox(r, c, box);
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

/**
 * 在掩码边界框内用泊松排斥采样放置山峰，使山峰尽量分散。
 * 优先放置在掩码非零区域的重心附近。
 */
function samplePeakCenters(
  count: number,
  nonZeroCells: [number, number][],
  box: BBox,
  rng: SeededRandom
): Point[] {
  if (nonZeroCells.length === 0) return [{ x: 0.5, y: 0.5 }];

  const minDist = clamp(0.5 / Math.sqrt(count), 0.15, 0.45);
  const placed: Point[] = [];

  for (let i = 0; i < count; i++) {
    let best: Point = { x: 0.5, y: 0.5 };
    let bestScore = -1;

    for (let trial = 0; trial < 400; trial++) {
      const cellIdx = Math.floor(rng.next() * nonZeroCells.length);
      const [cr, cc] = nonZeroCells[cellIdx];
      const jitter = 0.08;
      const base = normalizeInBox(cr, cc, box);
      const candidate = {
        x: clamp(base.x + (rng.next() - 0.5) * jitter, 0, 1),
        y: clamp(base.y + (rng.next() - 0.5) * jitter, 0, 1),
      };

      let minD = Infinity;
      for (const p of placed) {
        const d = Math.hypot(candidate.x - p.x, candidate.y - p.y);
        if (d < minD) minD = d;
      }

      if (placed.length === 0 || minD >= minDist) {
        best = candidate;
        break;
      }
      if (minD > bestScore) {
        best = candidate;
        bestScore = minD;
      }
    }
    placed.push(best);
  }

  return placed;
}

// ─── 高斯高度场（带 roundness 控制）──────────────────────────────────────────

/**
 * 计算单个山峰对某点的高度贡献。
 * roundness 控制等高线形状：
 *   - 1.0 = L2 距离（正圆高斯）
 *   - 接近 0 = Lp 范数混合（等高线趋向菱形/方形）
 * 实际上 roundness 控制指数 p：p = lerp(1.0, 2.0, roundness)
 */
function hillGaussian(
  nx: number, ny: number,
  cx: number, cy: number,
  radius: number,
  roundness: number
): number {
  const p = lerp(1.2, 2.0, roundness);
  const dx = Math.abs(nx - cx) / radius;
  const dy = Math.abs(ny - cy) / radius;
  const dist = Math.pow(Math.pow(dx, p) + Math.pow(dy, p), 1 / p);
  return Math.exp(-2.5 * dist * dist);
}

// ─── 高度场构建 ────────────────────────────────────────────────────────────────

function buildHeightField(
  rows: number,
  cols: number,
  nonZeroMask: Uint8Array,
  box: BBox,
  peaks: Point[],
  peakRadius: number,
  roundness: number,
  noiseAmount: number,
  seed: number
): Float64Array {
  const raw = new Float64Array(rows * cols);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!nonZeroMask[r * cols + c]) continue;
      const { x: nx, y: ny } = normalizeInBox(r, c, box);

      // 多峰 soft-max 融合：避免峰值区域被平均压低
      let maxH = 0;
      let softSum = 0;
      let softWeight = 0;
      const kSoft = 8;

      for (const peak of peaks) {
        const h = hillGaussian(nx, ny, peak.x, peak.y, peakRadius, roundness);
        if (h > maxH) maxH = h;
        const w = Math.exp(kSoft * h);
        softSum += h * w;
        softWeight += w;
      }

      // soft-max 融合，给最近山峰更高权重
      const baseH = softWeight > 0 ? softSum / softWeight : maxH;

      // 叠加轻微噪声扰动（频率较高，幅度受 noiseAmount 控制）
      const noiseVal = (valueNoise(nx * 8, ny * 8, seed) - 0.5) * 2;
      raw[r * cols + c] = clamp(baseH + noiseVal * noiseAmount * baseH, 0, 1);
    }
  }

  return raw;
}

// ─── 等面积重映射 ──────────────────────────────────────────────────────────────

function equalAreaRemap(values: Float64Array, indices: number[]): Float64Array {
  const n = indices.length;
  if (n === 0) return new Float64Array(0);
  const sorted = [...indices].sort((a, b) => values[a] - values[b]);
  const out = new Float64Array(values.length).fill(-1);
  for (let rank = 0; rank < n; rank++) {
    out[sorted[rank]] = n > 1 ? rank / (n - 1) : 1;
  }
  return out;
}

// ─── 分层切割 ─────────────────────────────────────────────────────────────────

function levelOf(v: number, totalLevels: number): number {
  if (v >= 1) return totalLevels;
  return Math.floor(v * totalLevels) + 1;
}

function buildContourLayers(
  rows: number,
  cols: number,
  nonZeroMask: Uint8Array,
  remapped: Float64Array,
  contourLevels: number
): Grid[] {
  const layers: Grid[] = Array.from({ length: contourLevels }, () =>
    Array.from({ length: rows }, () => new Array(cols).fill(0))
  );

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!nonZeroMask[idx] || remapped[idx] < 0) continue;
      const lv = levelOf(remapped[idx], contourLevels);
      layers[lv - 1][r][c] = lv;
    }
  }
  return layers;
}

// ─── 后处理（形态学清理，直接内嵌）──────────────────────────────────────────

const DR = [-1, 1, 0, 0];
const DC = [0, 0, -1, 1];

/**
 * 在 grid 上做四邻域连通区域 BFS。
 * `bound` 非空时把它当作可行走域：域外既不扩展也不计入邻居统计，
 * 并视同网格边界（touchesBorder）——后处理据此不会溢出掩码。
 */
function bfsRegion(
  grid: Grid,
  startR: number,
  startC: number,
  visited: Uint8Array,
  rows: number,
  cols: number,
  targetValue: number,
  bound: Uint8Array | null = null
): { cells: [number, number][]; touchesBorder: boolean; neighborCount: Map<number, number> } {
  const cells: [number, number][] = [];
  const neighborCount = new Map<number, number>();
  let touchesBorder = false;
  const queue: [number, number][] = [[startR, startC]];
  visited[startR * cols + startC] = 1;

  while (queue.length > 0) {
    const [r, c] = queue.shift()!;
    cells.push([r, c]);
    if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) touchesBorder = true;

    for (let d = 0; d < 4; d++) {
      const nr = r + DR[d];
      const nc = c + DC[d];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (bound && !bound[nr * cols + nc]) {
        touchesBorder = true;
        continue;
      }
      const nv = grid[nr][nc];
      if (nv !== targetValue) {
        if (nv !== 0) neighborCount.set(nv, (neighborCount.get(nv) ?? 0) + 1);
        continue;
      }
      if (visited[nr * cols + nc]) continue;
      visited[nr * cols + nc] = 1;
      queue.push([nr, nc]);
    }
  }

  return { cells, touchesBorder, neighborCount };
}

function mergeLayers(layers: Grid[]): Grid {
  const rows = layers[0].length;
  const cols = layers[0][0].length;
  const merged: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (const g of layers) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (g[r][c] !== 0) merged[r][c] = g[r][c];
      }
    }
  }
  return merged;
}

function fillHoles(grid: Grid, minHoleSize: number, mask: Uint8Array): Grid {
  const rows = grid.length;
  const cols = grid[0].length;
  const result: Grid = grid.map((r) => [...r]);
  const visited = new Uint8Array(rows * cols);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!mask[r * cols + c] || result[r][c] !== 0 || visited[r * cols + c]) continue;
      const { cells, touchesBorder, neighborCount } = bfsRegion(result, r, c, visited, rows, cols, 0, mask);
      if (!touchesBorder && neighborCount.size === 1 && cells.length <= minHoleSize) {
        const fillVal = [...neighborCount.keys()][0];
        for (const [fr, fc] of cells) result[fr][fc] = fillVal;
      }
    }
  }
  return result;
}

function removeIslands(grid: Grid, minIslandSize: number): Grid {
  const rows = grid.length;
  const cols = grid[0].length;
  const result: Grid = grid.map((r) => [...r]);
  const visited = new Uint8Array(rows * cols);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = result[r][c];
      if (v === 0 || visited[r * cols + c]) continue;
      const { cells } = bfsRegion(result, r, c, visited, rows, cols, v);
      if (cells.length < minIslandSize) {
        for (const [dr, dc] of cells) result[dr][dc] = 0;
      }
    }
  }
  return result;
}

function fillVoids(grid: Grid, mask: Uint8Array): Grid {
  const rows = grid.length;
  const cols = grid[0].length;
  const result: Grid = grid.map((r) => [...r]);
  const visited = new Uint8Array(rows * cols);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!mask[r * cols + c] || result[r][c] !== 0 || visited[r * cols + c]) continue;
      const { cells, neighborCount } = bfsRegion(result, r, c, visited, rows, cols, 0, mask);
      if (neighborCount.size === 0) continue;

      let bestVal = 0;
      let bestCount = 0;
      for (const [val, cnt] of neighborCount) {
        if (cnt > bestCount) { bestCount = cnt; bestVal = val; }
      }
      for (const [fr, fc] of cells) result[fr][fc] = bestVal;
    }
  }
  return result;
}

function splitToLayers(merged: Grid, layerCount: number, rows: number, cols: number): Grid[] {
  const layers: Grid[] = Array.from({ length: layerCount }, () =>
    Array.from({ length: rows }, () => new Array(cols).fill(0))
  );

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = merged[r][c];
      if (v >= 1 && v <= layerCount) {
        layers[v - 1][r][c] = v;
      }
    }
  }
  return layers;
}

function postProcess(layers: Grid[], minHoleSize: number, minIslandSize: number, mask: Uint8Array): Grid[] {
  const rows = layers[0].length;
  const cols = layers[0][0].length;
  const layerCount = layers.length;

  const merged = mergeLayers(layers);
  const afterFill = fillHoles(merged, minHoleSize, mask);
  const afterRemove = removeIslands(afterFill, minIslandSize);
  const afterVoid = fillVoids(afterRemove, mask);
  return splitToLayers(afterVoid, layerCount, rows, cols);
}

// ─── 实心嵌套面 ────────────────────────────────────────────────────────────────

/**
 * 把互斥的多值网格累积成实心嵌套面：第 i 张含所有层号 ≥ i 的格子，格值统一写 i。
 * 只保留非空的层，避免下游为一张全 0 网格建出空节点。
 */
function accumulateSolidLayers(
  merged: Grid,
  layerCount: number,
): { grids: Grid[]; levels: number[]; ids: number[] } {
  const rows = merged.length;
  const cols = merged[0].length;
  const grids: Grid[] = [];
  const levels: number[] = [];
  const ids: number[] = [];

  for (let lv = 1; lv <= layerCount; lv++) {
    const face: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
    let count = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (merged[r][c] >= lv) { face[r][c] = lv; count++; }
      }
    }
    if (count === 0) continue;
    grids.push(face);
    // 层顶高度：最低层贴地（z=0），每上一层抬高一个悬崖高度
    levels.push(lv - 1);
    ids.push(lv);
  }
  return { grids, levels, ids };
}

// ─── 主导出函数 ────────────────────────────────────────────────────────────────

/** 对单个网格执行等高线生成，返回实心嵌套层 + 多值网格 + 名称清单 */
function processOneGrid(
  grid: Grid,
  contourLevels: number,
  hillCount: number,
  roundness: number,
  peakRadius: number,
  noiseAmount: number,
  minHoleSize: number,
  minIslandSize: number,
  seed: number,
  peakPositionRaw: unknown,
): { outputGrids: Grid[]; outputLevels: number[]; outputGrid: Grid; outputNameList: NameEntry[] } {
  const rows = grid.length;
  const cols = grid[0].length;
  const rng  = new SeededRandom(seed);

  let peakPosition: number;
  if (typeof peakPositionRaw === "number" && !isNaN(peakPositionRaw)) {
    peakPosition = clamp(Math.round(peakPositionRaw), 1, 9);
  } else {
    peakPosition = Math.floor(rng.next() * 9) + 1;
  }

  const nonZeroMask = new Uint8Array(rows * cols);
  const nonZeroCells: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((grid[r]?.[c] ?? 0) !== 0) {
        nonZeroMask[r * cols + c] = 1;
        nonZeroCells.push([r, c]);
      }
    }
  }

  const emptyGrid = (): Grid => Array.from({ length: rows }, () => new Array(cols).fill(0));

  if (nonZeroCells.length === 0) {
    return { outputGrids: [], outputLevels: [], outputGrid: emptyGrid(), outputNameList: [] };
  }

  let minR = rows, maxR = 0, minC = cols, maxC = 0;
  for (const [r, c] of nonZeroCells) {
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (c < minC) minC = c;
    if (c > maxC) maxC = c;
  }
  const box: BBox = { minR, maxR, minC, maxC };

  const fixedPeak = snapToMask(numpadToNormalized(peakPosition), nonZeroCells, box);
  const peaks: Point[] = hillCount === 1
    ? [fixedPeak]
    : [fixedPeak, ...samplePeakCenters(hillCount - 1, nonZeroCells, box, rng)];

  const raw = buildHeightField(rows, cols, nonZeroMask, box, peaks, peakRadius, roundness, noiseAmount, seed);
  const nonZeroIdx = nonZeroCells.map(([r, c]) => r * cols + c);
  const remapped = equalAreaRemap(raw, nonZeroIdx);
  const rawLayers = buildContourLayers(rows, cols, nonZeroMask, remapped, contourLevels);
  const contourLayers = postProcess(rawLayers, minHoleSize, minIslandSize, nonZeroMask);

  // 各层互斥，合并到单张多值网格（格值=层序号）
  const outputGrid = mergeLayers(contourLayers);

  // 每层累积成实心面，使隐藏上层时露出下一层顶面而不是地面
  const { grids: outputGrids, levels: outputLevels, ids } = accumulateSolidLayers(outputGrid, contourLevels);

  const outputNameList: NameEntry[] = ids.map(id => ({
    id, name: `山包层${id}`, type: "tile",
  }));

  return { outputGrids, outputLevels, outputGrid, outputNameList };
}

export function hillContourGenerate(input: Record<string, unknown>): Record<string, unknown> {
  const rawGrid = input.inputGrid;
  if (!isGrid(rawGrid)) {
    return { error: "inputGrid is required (number[][])" };
  }
  const grid = rawGrid as Grid;

  const contourLevels = typeof input.contourLevels === "number" ? Math.max(2, Math.round(input.contourLevels)) : 6;
  const hillCount     = typeof input.hillCount     === "number" ? Math.max(1, Math.round(input.hillCount))     : 1;
  const roundness     = typeof input.roundness     === "number" ? clamp(input.roundness, 0, 1)                : 0.85;
  const peakRadius    = typeof input.peakRadius    === "number" ? clamp(input.peakRadius, 0.05, 0.8)          : 0.35;
  const noiseAmount   = typeof input.noiseAmount   === "number" ? clamp(input.noiseAmount, 0, 0.5)            : 0.12;
  const minHoleSize   = typeof input.minHoleSize   === "number" ? Math.max(1, Math.round(input.minHoleSize))  : 20;
  const minIslandSize = typeof input.minIslandSize === "number" ? Math.max(1, Math.round(input.minIslandSize)): 8;
  const baseSeed      = typeof input.seed          === "number" ? input.seed : 0;

  const { outputGrids, outputLevels, outputGrid, outputNameList } = processOneGrid(
    grid, contourLevels, hillCount, roundness, peakRadius, noiseAmount,
    minHoleSize, minIslandSize, baseSeed, input.peakPosition,
  );

  return { outputGrids, outputLevels, outputGrid, outputNameList };
}
