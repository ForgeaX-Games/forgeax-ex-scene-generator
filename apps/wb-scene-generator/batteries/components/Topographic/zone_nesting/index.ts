/**
 * zone_nesting: 区域嵌套
 * 先对目标区域做多层侵蚀得到有机轮廓，再可选地对轮廓做闭合样条平滑并重绘。
 *
 * DataTree 数据格式：输入 inputGrid 与输出 outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 */

import {
  movingAverageClosed,
  gaussianFilterClosed,
  bezierSplineClosed,
  cubicSplineClosed,
  polylinePerturbClosed,
  type Point,
} from "./algorithm";

import {
  traceBoundaryContour,
  rasterizeFilledContour,
} from "./contour";

type Grid = number[][];
type RngFn = () => number;

function createRng(seed: number): RngFn {
  let s = (seed & 0xffffffff) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

function cloneGrid(grid: Grid): Grid {
  return grid.map(row => [...row]);
}

function getEdgeCells(grid: Grid, targetValue: number): [number, number][] {
  const rows = grid.length;
  const cols = grid[0].length;
  const edges: [number, number][] = [];
  const dirs4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== targetValue) continue;
      for (const [dr, dc] of dirs4) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || grid[nr][nc] !== targetValue) {
          edges.push([r, c]);
          break;
        }
      }
    }
  }
  return edges;
}

function countSameNeighbors(grid: Grid, r: number, c: number, targetValue: number): number {
  const rows = grid.length, cols = grid[0].length;
  let count = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] === targetValue) {
        count++;
      }
    }
  }
  return count;
}

function cellularErosion(
  grid: Grid,
  targetValue: number,
  erosionStrength: number,
  layers: number,
  rng: RngFn,
): Grid {
  let current = cloneGrid(grid);

  for (let layer = 0; layer < layers; layer++) {
    const next = cloneGrid(current);
    const edges = getEdgeCells(current, targetValue);

    for (const [r, c] of edges) {
      const neighbors = countSameNeighbors(current, r, c, targetValue);
      const isolationFactor = 1 - neighbors / 8;
      const prob = erosionStrength * (0.35 + isolationFactor * 0.65);
      if (rng() < prob) {
        next[r][c] = 0;
      }
    }
    current = next;
  }
  return current;
}

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

function noiseErosion(
  grid: Grid,
  targetValue: number,
  erosionStrength: number,
  layers: number,
  seed: number,
): Grid {
  let current = cloneGrid(grid);
  const scale = 0.1;

  for (let layer = 0; layer < layers; layer++) {
    const next = cloneGrid(current);
    const edges = getEdgeCells(current, targetValue);
    const threshold = 1 - erosionStrength * (0.45 + layer * 0.12);

    for (const [r, c] of edges) {
      const noiseVal = fbm(c * scale, r * scale, seed);
      if (noiseVal > threshold) {
        next[r][c] = 0;
      }
    }
    current = next;
  }
  return current;
}

function randomWalkErosion(
  grid: Grid,
  targetValue: number,
  erosionStrength: number,
  layers: number,
  rng: RngFn,
): Grid {
  let current = cloneGrid(grid);
  const rows = grid.length, cols = grid[0].length;
  const dirs4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  for (let layer = 0; layer < layers; layer++) {
    const next = cloneGrid(current);
    const edges = getEdgeCells(current, targetValue);
    if (edges.length === 0) break;

    const walkerCount = Math.max(1, Math.floor(edges.length * erosionStrength * 0.25));
    const walkDepth = Math.max(1, Math.ceil(1 + erosionStrength * 3));

    for (let i = 0; i < walkerCount; i++) {
      let [r, c] = edges[Math.floor(rng() * edges.length)];
      for (let step = 0; step < walkDepth; step++) {
        if (r < 0 || r >= rows || c < 0 || c >= cols) break;
        if (current[r][c] !== targetValue) break;
        next[r][c] = 0;
        const dir = dirs4[Math.floor(rng() * 4)];
        r += dir[0];
        c += dir[1];
      }
    }
    current = next;
  }
  return current;
}

// —— 样条后处理（自 edge_spline）——

function computeCurvatures(points: Point[]): number[] {
  const n = points.length;
  if (n < 3) return new Array(n).fill(0);

  const curvatures: number[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n];
    const p1 = points[i];
    const p2 = points[(i + 1) % n];

    const v1x = p1[0] - p0[0], v1y = p1[1] - p0[1];
    const v2x = p2[0] - p1[0], v2y = p2[1] - p1[1];

    const len1 = Math.hypot(v1x, v1y);
    const len2 = Math.hypot(v2x, v2y);

    if (len1 < 0.001 || len2 < 0.001) {
      curvatures.push(0);
      continue;
    }

    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
    const cross = (v1x * v2y - v1y * v2x) / (len1 * len2);
    const angle = Math.abs(Math.atan2(cross, dot));
    curvatures.push(angle);
  }
  return curvatures;
}

function subsampleByCurvature(points: Point[], targetCount: number): Point[] {
  const n = points.length;
  if (n <= targetCount) return points;

  const curvatures = computeCurvatures(points);

  const minCurv = Math.min(...curvatures);
  const maxCurv = Math.max(...curvatures);
  const range = maxCurv - minCurv || 1;

  const weights = curvatures.map(c => 0.3 + 0.7 * ((c - minCurv) / range));

  let totalWeight = 0;
  for (const w of weights) totalWeight += w;

  const cumulative: number[] = [];
  let sum = 0;
  for (const w of weights) {
    sum += w;
    cumulative.push(sum);
  }

  const result: Point[] = [];
  const step = totalWeight / targetCount;

  for (let i = 0; i < targetCount; i++) {
    const target = (i + 0.5) * step;
    let idx = cumulative.findIndex(c => c >= target);
    if (idx === -1) idx = n - 1;
    result.push(points[idx]);
  }

  const seen = new Set<string>();
  const unique: Point[] = [];
  for (const p of result) {
    const key = `${Math.round(p[0])},${Math.round(p[1])}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }

  return unique.length >= 4 ? unique : result;
}

function applySplineToRegion(
  grid: Grid,
  regionId: number,
  backgroundId: number,
  algorithm: string,
  smoothness: number,
  splineSeed: number,
): { ok: true; grid: Grid; points: Point[] } | { ok: false; error: string } {
  const contour = traceBoundaryContour(grid, regionId);

  if (contour.length < 3) {
    return { ok: false, error: `找不到 regionId=${regionId} 的有效区域边界（至少需要 3 个边界像素）` };
  }

  let controlPoints: Point[] = contour;

  if (algorithm === "bezier") {
    const n = contour.length;
    const target = Math.max(20, Math.min(n, Math.round(n / smoothness)));
    if (target < n) {
      controlPoints = subsampleByCurvature(contour, target);
    }
  } else if (algorithm === "cubic_spline") {
    const n = contour.length;
    const target = Math.max(8, Math.min(n, Math.round(n / (1.5 * smoothness))));
    if (target < n) {
      controlPoints = subsampleByCurvature(contour, target);
    }
  }

  const applyAlgorithm = (pts: Point[]): Point[] => {
    if (pts.length < 3) return pts;
    switch (algorithm) {
      case "moving_avg":       return movingAverageClosed(pts, smoothness);
      case "gaussian":         return gaussianFilterClosed(pts, smoothness);
      case "cubic_spline":     return cubicSplineClosed(pts, smoothness);
      case "polyline_perturb": return polylinePerturbClosed(pts, smoothness, splineSeed);
      case "bezier":
      default:                 return bezierSplineClosed(pts, smoothness);
    }
  };

  const splined = applyAlgorithm(controlPoints);

  if (splined.length < 3) {
    return { ok: false, error: "样条化结果点数不足，无法重建区域" };
  }

  const outputGrid = rasterizeFilledContour(grid, splined, regionId, backgroundId);
  return { ok: true, grid: outputGrid, points: splined };
}

/** 解析单个二维网格（number[][]）；非法返回 null。
 * DataTree 模型下引擎按 access:item 对网格列表自动 fanout，本算子每次只收到一张网格。 */
function parseGrid(raw: unknown): Grid | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  if (Array.isArray(raw[0]) && typeof (raw[0] as unknown[])[0] === "number") {
    return raw as Grid;
  }
  return null;
}

/** 对单个网格执行侵蚀+样条处理 */
function processOneGrid(
  inputGrid: Grid,
  targetValue: number,
  erosionStrength: number,
  layers: number,
  algorithm: string,
  seed: number,
  splineAlgorithm: string,
  splineSmoothness: number,
  splineSeed: number,
  backgroundId: number,
): { ok: true; grid: Grid; points: Point[] } | { ok: false; error: string } {
  const rng = createRng(seed);
  let outputGrid: Grid;

  switch (algorithm) {
    case "noise":
      outputGrid = noiseErosion(inputGrid, targetValue, erosionStrength, layers, seed);
      break;
    case "random_walk":
      outputGrid = randomWalkErosion(inputGrid, targetValue, erosionStrength, layers, rng);
      break;
    case "cellular":
    default:
      outputGrid = cellularErosion(inputGrid, targetValue, erosionStrength, layers, rng);
  }

  return applySplineToRegion(outputGrid, targetValue, backgroundId, splineAlgorithm, splineSmoothness, splineSeed);
}

export function zoneNesting(input: Record<string, unknown>): Record<string, unknown> {
  const grid = parseGrid(input.inputGrid);
  if (!grid) {
    return { error: "inputGrid is required" };
  }

  const targetValue = typeof input.targetValue === "number" ? Math.round(input.targetValue) : 1;
  const rawErosion = typeof input.erosionStrength === "number" ? input.erosionStrength : 20;
  // >1 视为 0~100 百分点；≤1 视为旧版 0~1 归一化强度（兼容旧管线）
  const erosionStrength =
    rawErosion > 1
      ? Math.min(1, Math.max(0, rawErosion / 100))
      : Math.min(1, Math.max(0, rawErosion));
  const layers = typeof input.layers === "number" ? Math.max(1, Math.round(input.layers)) : 12;
  const algorithm = typeof input.algorithm === "string" ? input.algorithm : "cellular";
  const rawSeed = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = rawSeed === 0 ? (Date.now() & 0x7fffffff) : rawSeed;

  let splineAlgorithm = typeof input.splineAlgorithm === "string" ? input.splineAlgorithm : "gaussian";
  if (splineAlgorithm === "none") splineAlgorithm = "gaussian";
  const splineSmoothness = typeof input.splineSmoothness === "number"
    ? Math.min(20, Math.max(1, Math.round(input.splineSmoothness)))
    : 5;
  const rawSplineSeed = typeof input.splineSeed === "number" ? input.splineSeed : 0;
  const baseSplineSeed = rawSplineSeed === 0 ? (Date.now() & 0x7fffffff) : rawSplineSeed;
  // 背景码值固定为 0（不再对外暴露）
  const backgroundId = 0;

  if (grid.length === 0 || grid[0].length === 0) {
    return { error: "inputGrid is empty" };
  }

  const sp = processOneGrid(
    grid,
    targetValue,
    erosionStrength,
    layers,
    algorithm,
    baseSeed,
    splineAlgorithm,
    splineSmoothness,
    baseSplineSeed,
    backgroundId,
  );

  // 样条阶段失败（区域过小/消失）时回落到侵蚀前的原始网格，保证下游始终拿到一张网格
  return { outputGrid: sp.ok ? sp.grid : grid };
}
