/**
 * zone_nesting_riverbank: 区域嵌套（河岸侵蚀）
 *
 * 与 zone_nesting 的均匀「等距偏移」侵蚀不同，本算子用一张低频平滑噪声场驱动
 * 每个边界段的「侵蚀深度」：噪声高处深切（内缘大幅退入 → 宽），噪声低处浅切
 * （内缘几乎贴着外缘 → 窄），从而让内边界形成深浅不一、忽宽忽窄的自然河岸式
 * 波动，而非与外轮廓保持一致的平行内缩。
 *
 * 流程：① padded 多源 BFS 求每个目标格到区域外缘的内向距离 d；
 *       ② 按 depth(x,y) = clamp(strength + (fbm-0.5)*2*waviness, 0,1) * maxDepth
 *          逐格判定 d ≤ depth 则侵蚀；③ 追踪外轮廓做闭合样条平滑并重绘。
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

function parseGrid(raw: unknown): Grid | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  if (Array.isArray(raw[0]) && typeof (raw[0] as unknown[])[0] === "number") {
    return raw as Grid;
  }
  return null;
}

function normStrength(raw: number): number {
  // >1 视为 0~100 百分点；≤1 视为 0~1 归一化
  return raw > 1 ? Math.min(1, Math.max(0, raw / 100)) : Math.min(1, Math.max(0, raw));
}

// —— FBM 低频噪声（驱动侵蚀深度场）——

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
  for (let i = 0; i < 4; i++) {
    value += valueNoise(x * frequency, y * frequency, seed + i * 17) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return value / total;
}

// —— padded 多源 BFS：每个目标格到区域外缘（含网格外）的内向距离 ——

function distanceInward(grid: Grid, targetValue: number): number[][] {
  const rows = grid.length, cols = grid[0].length;
  const PR = rows + 2, PC = cols + 2;
  const dist: number[][] = Array.from({ length: PR }, () => new Array(PC).fill(-1));
  const qr: number[] = [], qc: number[] = [];

  // 种子：所有「非目标」格（含外围一圈虚拟背景）距离 0
  for (let r = 0; r < PR; r++) {
    for (let c = 0; c < PC; c++) {
      const inside = r >= 1 && r <= rows && c >= 1 && c <= cols;
      const isTarget = inside && grid[r - 1][c - 1] === targetValue;
      if (!isTarget) { dist[r][c] = 0; qr.push(r); qc.push(c); }
    }
  }

  const d4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  let head = 0;
  while (head < qr.length) {
    const r = qr[head], c = qc[head]; head++;
    for (const [dr, dc] of d4) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= PR || nc < 0 || nc >= PC) continue;
      if (dist[nr][nc] !== -1) continue;
      dist[nr][nc] = dist[r][c] + 1;
      qr.push(nr); qc.push(nc);
    }
  }

  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => dist[r + 1][c + 1]),
  );
}

// —— 变深度（河岸式）侵蚀 ——

function riverbankErosion(
  grid: Grid,
  targetValue: number,
  strength: number,
  maxDepth: number,
  waviness: number,
  scale: number,
  seed: number,
): Grid {
  const rows = grid.length, cols = grid[0].length;
  const dist = distanceInward(grid, targetValue);
  const out = grid.map(row => [...row]);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== targetValue) continue;
      const d = dist[r][c]; // 目标格 ≥ 1
      const n = fbm(c * scale, r * scale, seed); // ~0..1
      let f = strength + (n - 0.5) * 2 * waviness;
      if (f < 0) f = 0; else if (f > 1) f = 1;
      const depth = f * maxDepth;
      if (d <= depth) out[r][c] = 0; // 侵蚀为背景
    }
  }
  return out;
}

// —— 样条后处理（与 zone_nesting 一致）——

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
    if (len1 < 0.001 || len2 < 0.001) { curvatures.push(0); continue; }
    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
    const cross = (v1x * v2y - v1y * v2x) / (len1 * len2);
    curvatures.push(Math.abs(Math.atan2(cross, dot)));
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
  for (const w of weights) { sum += w; cumulative.push(sum); }
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
    if (!seen.has(key)) { seen.add(key); unique.push(p); }
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
): { ok: true; grid: Grid } | { ok: false } {
  const contour = traceBoundaryContour(grid, regionId);
  if (contour.length < 3) return { ok: false };

  let controlPoints: Point[] = contour;
  if (algorithm === "bezier") {
    const n = contour.length;
    const target = Math.max(20, Math.min(n, Math.round(n / smoothness)));
    if (target < n) controlPoints = subsampleByCurvature(contour, target);
  } else if (algorithm === "cubic_spline") {
    const n = contour.length;
    const target = Math.max(8, Math.min(n, Math.round(n / (1.5 * smoothness))));
    if (target < n) controlPoints = subsampleByCurvature(contour, target);
  }

  const applyAlgorithm = (pts: Point[]): Point[] => {
    if (pts.length < 3) return pts;
    switch (algorithm) {
      case "moving_avg":       return movingAverageClosed(pts, smoothness);
      case "cubic_spline":     return cubicSplineClosed(pts, smoothness);
      case "polyline_perturb": return polylinePerturbClosed(pts, smoothness, splineSeed);
      case "bezier":           return bezierSplineClosed(pts, smoothness);
      case "gaussian":
      default:                 return gaussianFilterClosed(pts, smoothness);
    }
  };

  const splined = applyAlgorithm(controlPoints);
  if (splined.length < 3) return { ok: false };
  return { ok: true, grid: rasterizeFilledContour(grid, splined, regionId, backgroundId) };
}

export function zoneNestingRiverbank(input: Record<string, unknown>): Record<string, unknown> {
  const grid = parseGrid(input.inputGrid);
  if (!grid) return { error: "inputGrid is required" };
  if (grid.length === 0 || grid[0].length === 0) return { error: "inputGrid is empty" };

  const targetValue = typeof input.targetValue === "number" ? Math.round(input.targetValue) : 1;
  const strength = normStrength(typeof input.erosionStrength === "number" ? input.erosionStrength : 54);
  const maxDepth = typeof input.maxDepth === "number" ? Math.max(1, Math.round(input.maxDepth)) : 16;
  const waviness = typeof input.waviness === "number" ? Math.max(0, input.waviness) : 0.8;
  const featureScale = typeof input.featureScale === "number" && input.featureScale > 0
    ? input.featureScale
    : 0.06;
  const rawSeed = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = rawSeed === 0 ? (Date.now() & 0x7fffffff) : rawSeed;

  let splineAlgorithm = typeof input.splineAlgorithm === "string" ? input.splineAlgorithm : "gaussian";
  if (splineAlgorithm === "none") splineAlgorithm = "gaussian";
  const splineSmoothness = typeof input.splineSmoothness === "number"
    ? Math.min(20, Math.max(1, Math.round(input.splineSmoothness)))
    : 5;
  const rawSplineSeed = typeof input.splineSeed === "number" ? input.splineSeed : 0;
  const baseSplineSeed = rawSplineSeed === 0 ? (Date.now() & 0x7fffffff) : rawSplineSeed;
  const backgroundId = 0;

  const eroded = riverbankErosion(grid, targetValue, strength, maxDepth, waviness, featureScale, baseSeed);
  const sp = applySplineToRegion(eroded, targetValue, backgroundId, splineAlgorithm, splineSmoothness, baseSplineSeed);

  // 样条阶段失败（区域过小/消失）时回落到侵蚀后的网格，保证下游始终拿到一张网格
  return { outputGrid: sp.ok ? sp.grid : eroded };
}
