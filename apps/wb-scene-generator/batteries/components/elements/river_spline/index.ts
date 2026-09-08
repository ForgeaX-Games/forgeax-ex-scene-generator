/**
 * riverSpline: 将折线控制点样条化为河流掩码写入网格
 *
 * 五种平滑算法（对应 Python 源码 picture_processor.py）：
 *   noise         — 折线扰动：控制点沿法线偏移后折线连接（原始扰动，无额外平滑）
 *   bezier        — 分段贝塞尔曲线平滑
 *   cubic_spline  — 累积弧长参数化三次样条插值（Catmull-Rom 近似）
 *   moving_avg    — 滑动窗口移动平均平滑
 *   gaussian      — 高斯核加权平均平滑
 *
 * DataTree 数据格式：输入 inputGrid 与输出 outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 *
 * 输入：inputGrid (grid) — 基准网格; points (array) — 控制点 [[col,row],...];
 *       algorithm (string) — 平滑算法; riverWidth (number) — 河流宽度(格);
 *       numMidPoints / offsetMin / offsetMax / segmentUniformity — 扰动参数;
 *       windowSize (moving_avg) / sigma (gaussian) / bezierDegree (bezier) — 各算法参数
 * 输出：outputGrid (grid) — 包含河流掩码的输出网格
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Vec2 = [number, number];

// ─────────────────────────────────────────────────────────────────────────────
// Seeded RNG (LCG, for deterministic perturbation)
// ─────────────────────────────────────────────────────────────────────────────

class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed !== 0 ? seed : Date.now(); }
  next(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) | 0;
    return (this.s >>> 0) / 0x100000000;
  }
  uniform(lo: number, hi: number): number { return lo + this.next() * (hi - lo); }
  randint(lo: number, hi: number): number { return lo + Math.floor(this.next() * (hi - lo + 1)); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Geometry helpers
// ─────────────────────────────────────────────────────────────────────────────

function dist2(a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/** 计算点列中每个点的切线（中心差分，端点单侧差分），返回归一化向量 */
function computeTangents(pts: Vec2[]): Vec2[] {
  const n = pts.length;
  const out: Vec2[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let tx: number, ty: number;
    if (i === 0) {
      tx = pts[1][0] - pts[0][0]; ty = pts[1][1] - pts[0][1];
    } else if (i === n - 1) {
      tx = pts[n-1][0] - pts[n-2][0]; ty = pts[n-1][1] - pts[n-2][1];
    } else {
      tx = pts[i+1][0] - pts[i-1][0]; ty = pts[i+1][1] - pts[i-1][1];
    }
    const len = Math.sqrt(tx * tx + ty * ty) || 1;
    out[i] = [tx / len, ty / len];
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Perturb control points along normals
// (Python: perturb_centerline_with_normal)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 从控制点序列中提取内部锚点，沿法线方向随机偏移，然后线性插值生成新路径。
 * 对应 Python perturb_centerline_with_normal。
 */
function perturbCenterline(
  pts: Vec2[],
  numMidPoints: number,
  offsetMin: number,
  offsetMax: number,
  segmentUniformity: number,
  rng: Rng
): Vec2[] {
  const n = pts.length;
  if (n < 2) return pts;
  numMidPoints = Math.max(0, numMidPoints);
  if (numMidPoints === 0) return [pts[0], pts[n - 1]];
  if (n < numMidPoints + 2) return pts;

  const midStart = Math.max(1, Math.floor(n * 0.05));
  const midEnd = Math.min(n - 1, Math.floor(n * 0.95));
  if (midEnd - midStart < numMidPoints) return pts;

  // 选取内部点索引
  const indices: number[] = [];
  if (segmentUniformity >= 0.9) {
    const step = (midEnd - midStart) / (numMidPoints + 1);
    for (let i = 0; i < numMidPoints; i++) indices.push(Math.floor(midStart + step * (i + 1)));
  } else if (segmentUniformity <= 0.1) {
    const pool = Array.from({ length: midEnd - midStart }, (_, i) => i + midStart);
    for (let i = pool.length - 1; i > 0 && indices.length < numMidPoints; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
      indices.push(pool[i]);
    }
    indices.sort((a, b) => a - b);
  } else {
    const step = (midEnd - midStart) / (numMidPoints + 1);
    const randomRange = Math.floor(step * (1 - segmentUniformity));
    for (let i = 0; i < numMidPoints; i++) {
      const base = midStart + step * (i + 1);
      const offset = rng.randint(-randomRange, randomRange);
      indices.push(Math.max(midStart, Math.min(midEnd - 1, Math.floor(base + offset))));
    }
    indices.sort((a, b) => a - b);
  }

  // 沿法线偏移
  const tangents = computeTangents(pts);
  const perturbedMids: Vec2[] = indices.map(idx => {
    const t = tangents[idx];
    const nx = -t[1], ny = t[0]; // 法线
    const d = rng.uniform(offsetMin, offsetMax);
    return [pts[idx][0] + nx * d, pts[idx][1] + ny * d];
  });

  // 关键点：start + perturbed mids + end，按 x 排序
  const keyPts: Vec2[] = [pts[0], ...perturbedMids, pts[n - 1]];
  keyPts.sort((a, b) => a[0] - b[0]);

  // 线性插值生成密集路径
  const result: Vec2[] = [];
  for (let i = 0; i < keyPts.length - 1; i++) {
    const p1 = keyPts[i], p2 = keyPts[i + 1];
    const segLen = dist2(p1, p2);
    const nPts = Math.max(2, Math.ceil(segLen));
    for (let s = 0; s < nPts; s++) {
      const t = s / nPts;
      result.push([p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]);
    }
  }
  result.push(keyPts[keyPts.length - 1]);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2a: Smooth — Moving Average
// (Python: smooth_centerline_moving_average)
// ─────────────────────────────────────────────────────────────────────────────

function smoothMovingAverage(pts: Vec2[], windowSize: number): Vec2[] {
  const n = pts.length;
  if (n < 3) return pts;
  let w = windowSize % 2 === 0 ? windowSize + 1 : windowSize;
  if (w > n) w = n % 2 === 1 ? n : n - 1;
  const half = Math.floor(w / 2);
  const out: Vec2[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(n, i + half + 1);
    let sx = 0, sy = 0;
    for (let j = start; j < end; j++) { sx += pts[j][0]; sy += pts[j][1]; }
    const cnt = end - start;
    out[i] = [sx / cnt, sy / cnt];
  }

  // Fix endpoints + transition blend
  out[0] = [...pts[0]];
  out[n - 1] = [...pts[n - 1]];
  for (let i = 1; i < Math.min(half + 1, n - 1); i++) {
    const w2 = 1 - i / half;
    out[i] = [w2 * pts[i][0] + (1 - w2) * out[i][0], w2 * pts[i][1] + (1 - w2) * out[i][1]];
  }
  for (let i = Math.max(n - half - 1, 1); i < n - 1; i++) {
    const dEnd = n - 1 - i;
    const w2 = 1 - dEnd / half;
    out[i] = [w2 * pts[i][0] + (1 - w2) * out[i][0], w2 * pts[i][1] + (1 - w2) * out[i][1]];
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2b: Smooth — Gaussian
// (Python: smooth_centerline_gaussian)
// ─────────────────────────────────────────────────────────────────────────────

function smoothGaussian(pts: Vec2[], sigma: number): Vec2[] {
  const n = pts.length;
  if (n < 3) return pts;
  let kSize = Math.floor(6 * sigma);
  if (kSize % 2 === 0) kSize++;
  if (kSize > n) kSize = n % 2 === 1 ? n : n - 1;
  if (kSize < 1) kSize = 1;
  const half = Math.floor(kSize / 2);

  const kernel: number[] = [];
  let ksum = 0;
  for (let x = -half; x <= half; x++) {
    const v = Math.exp(-(x * x) / (2 * sigma * sigma));
    kernel.push(v); ksum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum;

  const out: Vec2[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const start = Math.max(0, i - half);
    const end = Math.min(n, i + half + 1);
    const kStart = half - (i - start);
    const kEnd = half + (end - i);
    let wx = 0, wy = 0, wsum = 0;
    for (let j = start; j < end; j++) {
      const ki = kStart + (j - start);
      if (ki < 0 || ki >= kEnd) continue;
      wx += pts[j][0] * kernel[ki];
      wy += pts[j][1] * kernel[ki];
      wsum += kernel[ki];
    }
    out[i] = wsum > 0 ? [wx / wsum, wy / wsum] : [...pts[i]];
  }

  // Fix endpoints + transition blend
  out[0] = [...pts[0]];
  out[n - 1] = [...pts[n - 1]];
  for (let i = 1; i < Math.min(half + 1, n - 1); i++) {
    const w2 = 1 - i / half;
    out[i] = [w2 * pts[i][0] + (1 - w2) * out[i][0], w2 * pts[i][1] + (1 - w2) * out[i][1]];
  }
  for (let i = Math.max(n - half - 1, 1); i < n - 1; i++) {
    const dEnd = n - 1 - i;
    const w2 = 1 - dEnd / half;
    out[i] = [w2 * pts[i][0] + (1 - w2) * out[i][0], w2 * pts[i][1] + (1 - w2) * out[i][1]];
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2c: Smooth — Segmented Bézier
// (Python: smooth_centerline_bezier via de Casteljau)
// ─────────────────────────────────────────────────────────────────────────────

/** de Casteljau 算法在 t 处求贝塞尔曲线值 */
function deCasteljau(ctrlPts: Vec2[], t: number): Vec2 {
  const pts = ctrlPts.map(p => [...p] as Vec2);
  const deg = pts.length - 1;
  for (let r = 1; r <= deg; r++) {
    for (let i = 0; i <= deg - r; i++) {
      pts[i] = [(1 - t) * pts[i][0] + t * pts[i + 1][0],
                (1 - t) * pts[i][1] + t * pts[i + 1][1]];
    }
  }
  return pts[0];
}

function smoothBezier(pts: Vec2[], degree: number, numPoints: number, segmentSize: number): Vec2[] {
  const n = pts.length;
  if (n < 2) return pts;

  degree = Math.max(1, degree);
  segmentSize = Math.max(degree + 1, segmentSize);
  const step = Math.max(1, Math.floor(segmentSize / 2));
  const result: Vec2[] = [];

  for (let i = 0; i < n; i += step) {
    const end = Math.min(i + segmentSize, n);
    const seg = pts.slice(i, end);
    if (seg.length < 2) continue;

    const maxCtrl = Math.min(seg.length, degree + 3);
    let ctrl: Vec2[];
    if (seg.length <= maxCtrl) {
      ctrl = seg;
    } else {
      ctrl = [];
      for (let k = 0; k < maxCtrl; k++) {
        ctrl.push(seg[Math.round((k / (maxCtrl - 1)) * (seg.length - 1))]);
      }
    }

    const pps = Math.max(10, Math.floor(numPoints / Math.ceil(n / step)));
    for (let s = 0; s < pps; s++) {
      result.push(deCasteljau(ctrl, s / pps));
    }
  }
  if (pts.length > 0) result.push(pts[n - 1]);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2d: Smooth — Cubic Spline (Catmull-Rom as arc-length parameterized)
// (Python: smooth_centerline_cubic_spline via scipy UnivariateSpline)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 累积弧长参数化 + Catmull-Rom 样条插值，近似复现 scipy UnivariateSpline(s=0, k=3)。
 * 曲线精确穿过所有控制点。
 */
function smoothCubicSpline(pts: Vec2[], numPoints: number): Vec2[] {
  const n = pts.length;
  if (n < 4) return pts;

  // 计算累积弧长参数 t
  const t: number[] = [0];
  for (let i = 1; i < n; i++) {
    t.push(t[i - 1] + dist2(pts[i - 1], pts[i]));
  }
  const totalLen = t[t.length - 1];
  if (totalLen === 0) return pts;
  const tn = t.map(v => v / totalLen);

  // 在均匀参数点上用 Catmull-Rom 插值
  const result: Vec2[] = [];
  const ghost0: Vec2 = [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]];
  const ghostN: Vec2 = [2 * pts[n-1][0] - pts[n-2][0], 2 * pts[n-1][1] - pts[n-2][1]];
  const ext = [ghost0, ...pts, ghostN];
  const tn2 = [-tn[1], ...tn, 1 + (1 - tn[n - 2])]; // 虚拟端点参数

  for (let s = 0; s <= numPoints; s++) {
    const u = s / numPoints;
    // 找到所在区间
    let seg = 1;
    for (let i = 1; i < tn2.length - 2; i++) {
      if (u <= tn2[i + 1]) { seg = i; break; }
      seg = i;
    }
    const t0 = tn2[seg - 1], t1 = tn2[seg], t2 = tn2[seg + 1], t3 = tn2[seg + 2];
    const dt = t2 - t1 || 1;
    const tt = Math.max(0, Math.min(1, (u - t1) / dt));
    const tt2 = tt * tt, tt3 = tt2 * tt;

    const p0 = ext[seg - 1], p1 = ext[seg], p2 = ext[seg + 1], p3 = ext[seg + 2];
    const alpha = 0.5;
    const f1 = -alpha * tt3 + 2 * alpha * tt2 - alpha * tt;
    const f2 = (2 - alpha) * tt3 + (alpha - 3) * tt2 + 1;
    const f3 = (alpha - 2) * tt3 + (3 - 2 * alpha) * tt2 + alpha * tt;
    const f4 = alpha * tt3 - alpha * tt2;

    result.push([
      f1 * p0[0] + f2 * p1[0] + f3 * p2[0] + f4 * p3[0],
      f1 * p0[1] + f2 * p1[1] + f3 * p2[1] + f4 * p3[1],
    ]);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3: Rasterize path onto grid (圆形笔刷)
// ─────────────────────────────────────────────────────────────────────────────

function rasterizePath(
  grid: number[][], path: Vec2[], fillValue: number, riverWidth: number
): number[][] {
  const rows = grid.length, cols = grid[0].length;
  const out: number[][] = grid.map(row => [...row]);
  const halfW = riverWidth / 2;
  const r2 = halfW * halfW;

  for (const [px, py] of path) {
    const minRow = Math.max(0, Math.floor(py - halfW - 1));
    const maxRow = Math.min(rows - 1, Math.ceil(py + halfW + 1));
    const minCol = Math.max(0, Math.floor(px - halfW - 1));
    const maxCol = Math.min(cols - 1, Math.ceil(px + halfW + 1));
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const dx = col - px, dy = row - py;
        if (dx * dx + dy * dy <= r2) out[row][col] = fillValue;
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function gridMax(grid: number[][]): number {
  let max = 0;
  for (const row of grid) for (const v of row) if (v > max) max = v;
  return max;
}

function parsePoints(raw: unknown[]): Vec2[] {
  const out: Vec2[] = [];
  for (const pt of raw) {
    if (Array.isArray(pt) && pt.length >= 2) {
      const col = Number(pt[0]), row = Number(pt[1]);
      if (!isNaN(col) && !isNaN(row)) out.push([col, row]);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export function riverSpline(input: Record<string, unknown>): Record<string, unknown> {
  const grid = input.inputGrid as number[][] | undefined;
  if (!grid || grid.length === 0 || grid[0].length === 0) {
    return { error: "inputGrid is required" };
  }

  const rawPts = input.points as unknown[] | undefined;
  if (!rawPts || rawPts.length < 2) {
    return { error: "points must contain at least 2 control points" };
  }
  const controlPoints = parsePoints(rawPts);
  if (controlPoints.length < 2) {
    return { error: "failed to parse control points, need at least 2 valid [col,row] entries" };
  }

  // ── Parameters ──────────────────────────────────────────────────────────
  const algorithm = typeof input.algorithm === "string" ? input.algorithm : "cubic_spline";
  const riverWidth = typeof input.riverWidth === "number" && input.riverWidth > 0
    ? input.riverWidth : 3;
  const numMidPoints = typeof input.numMidPoints === "number"
    ? Math.max(0, Math.floor(input.numMidPoints)) : 3;
  const offsetMin = typeof input.offsetMin === "number" ? input.offsetMin : -30;
  const offsetMax = typeof input.offsetMax === "number" ? input.offsetMax : 30;
  const segmentUniformity = typeof input.segmentUniformity === "number"
    ? Math.max(0, Math.min(1, input.segmentUniformity)) : 0.5;
  const seed = typeof input.seed === "number" ? Math.floor(input.seed) : 0;
  const windowSize = typeof input.windowSize === "number"
    ? Math.max(3, Math.floor(input.windowSize)) : 5;
  const sigma = typeof input.sigma === "number" && input.sigma > 0 ? input.sigma : 2.0;
  const bezierDegree = typeof input.bezierDegree === "number"
    ? Math.max(1, Math.floor(input.bezierDegree)) : 3;
  const numSamples = Math.max(50, controlPoints.length * 20);

  const rng = new Rng(seed);

  // ── Step 1: Perturb ──────────────────────────────────────────────────────
  const perturbed = perturbCenterline(
    controlPoints, numMidPoints, offsetMin, offsetMax, segmentUniformity, rng
  );

  // ── Step 2: Algorithm-specific smooth ───────────────────────────────────
  let smoothed: Vec2[];
  switch (algorithm) {
    case "noise":
      smoothed = perturbed; // 折线扰动：直接使用扰动后路径，不再额外平滑
      break;
    case "bezier":
      smoothed = smoothBezier(perturbed, bezierDegree, numSamples, 15);
      break;
    case "cubic_spline":
      smoothed = smoothCubicSpline(perturbed, numSamples);
      break;
    case "moving_avg":
      smoothed = smoothMovingAverage(perturbed, windowSize);
      break;
    case "gaussian":
      smoothed = smoothGaussian(perturbed, sigma);
      break;
    default:
      smoothed = smoothCubicSpline(perturbed, numSamples);
  }

  // ── Step 3: Rasterize ────────────────────────────────────────────────────
  const fillValue = gridMax(grid) + 1;
  const outputGrid = rasterizePath(grid, smoothed, fillValue, riverWidth);

  return { outputGrid };
}
