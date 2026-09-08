/**
 * building_carve: 对输入 grid 非零区域的包围盒执行两层建筑退线，
 * 并将退线结果以中心点为基准等比放大，使最终形状的包围盒与原始包围盒一致。
 *
 * 输入：gridList (array) — 源网格列表，非零像素的包围盒作为建筑矩形
 *       seed (number)    — 随机种子，0 使用时间戳
 * 输出：outputGridList (array) — 与输入一一对应，建筑区域=1，其余=0
 *
 * 算法：
 * 1. 两层分段退线（与 building_profile 相同）→ 得到退线形状
 * 2. 以退线形状中心为基准，计算缩放比例使其包围盒 == 原始 bbox
 * 3. 对原始 bbox 范围内每个像素，做反向映射到退线形状坐标系，最近邻采样
 */

type Rect = { minR: number; maxR: number; minC: number; maxC: number };

// mulberry32 seeded PRNG
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedSample(rand: () => number, values: number[], weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < values.length; i++) {
    r -= weights[i];
    if (r <= 0) return values[i];
  }
  return values[values.length - 1];
}

function getBoundingBox(grid: number[][]): Rect | null {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  let minR = rows, maxR = -1, minC = cols, maxC = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  if (maxR === -1) return null;
  return { minR, maxR, minC, maxC };
}

function applyLayer1(
  bbox: Rect,
  rand: () => number
): { inner: Rect; setbacks: { top: number; bottom: number; left: number; right: number } } {
  const values = [1, 2, 3, 4];
  const weights = [90, 70, 25, 15];

  const top = weightedSample(rand, values, weights);
  const bottom = weightedSample(rand, values, weights);
  const left = weightedSample(rand, values, weights);
  const right = weightedSample(rand, values, weights);

  const height = bbox.maxR - bbox.minR + 1;
  const width = bbox.maxC - bbox.minC + 1;
  const safeTop = Math.min(top, Math.floor((height - 1) / 2));
  const safeBottom = Math.min(bottom, height - 1 - safeTop);
  const safeLeft = Math.min(left, Math.floor((width - 1) / 2));
  const safeRight = Math.min(right, width - 1 - safeLeft);

  return {
    inner: {
      minR: bbox.minR + safeTop,
      maxR: bbox.maxR - safeBottom,
      minC: bbox.minC + safeLeft,
      maxC: bbox.maxC - safeRight,
    },
    setbacks: { top: safeTop, bottom: safeBottom, left: safeLeft, right: safeRight },
  };
}

function layer2Probs(setback: number): { inwardProb: number; outwardProb: number } {
  const t = (setback - 1) / 3;
  const inwardProb = 0.80 - t * (0.80 - 0.20);
  const outwardProb = 0.10 - t * (0.10 - 0.02);
  return { inwardProb, outwardProb };
}

function segmentCount(length: number): number {
  return Math.min(6, Math.max(1, Math.ceil(length / 7)));
}

function splitSegments(len: number, n: number): Array<[number, number]> {
  const segments: Array<[number, number]> = [];
  const base = Math.floor(len / n);
  const extra = len % n;
  let pos = 0;
  for (let i = 0; i < n; i++) {
    const segLen = base + (i < extra ? 1 : 0);
    segments.push([pos, pos + segLen]);
    pos += segLen;
  }
  return segments;
}

function applyLayer2(
  bbox: Rect,
  inner: Rect,
  setbacks: { top: number; bottom: number; left: number; right: number },
  rand: () => number,
  rows: number,
  cols: number
): number[][] {
  const innerWidth = inner.maxC - inner.minC + 1;
  const innerHeight = inner.maxR - inner.minR + 1;

  const topOffset = new Array(innerWidth).fill(0);
  const bottomOffset = new Array(innerWidth).fill(0);
  const leftOffset = new Array(innerHeight).fill(0);
  const rightOffset = new Array(innerHeight).fill(0);

  type EdgeSide = "top" | "bottom" | "left" | "right";
  const edges: EdgeSide[] = ["top", "bottom", "left", "right"];

  for (const side of edges) {
    const isHorizontal = side === "top" || side === "bottom";
    const edgeLen = isHorizontal ? innerWidth : innerHeight;
    const edgeSetback = setbacks[side];
    const { inwardProb, outwardProb } = layer2Probs(edgeSetback);
    const nSeg = segmentCount(edgeLen);
    const segments = splitSegments(edgeLen, nSeg);
    const offsetArr = side === "top" ? topOffset
      : side === "bottom" ? bottomOffset
      : side === "left" ? leftOffset
      : rightOffset;

    const maxOutward = setbacks[side];

    for (const [segStart, segEnd] of segments) {
      const rv = rand();
      let direction = 0;
      if (rv < inwardProb) {
        direction = 1;
      } else if (rv < inwardProb + outwardProb) {
        direction = -1;
      }
      if (direction === 0) continue;

      const rv2 = rand();
      let magnitude: number;
      if (direction > 0) {
        magnitude = rv2 < 0.70 ? 1 : 2;
      } else {
        magnitude = (rv2 < 0.80 || maxOutward < 2) ? 1 : 2;
      }
      const delta = direction * magnitude;

      for (let i = segStart; i < segEnd; i++) {
        if (delta < 0) {
          offsetArr[i] = Math.max(-maxOutward, offsetArr[i] + delta);
        } else {
          offsetArr[i] = offsetArr[i] + delta;
        }
      }
    }
  }

  const topActual = topOffset.map(off => inner.minR + off);
  const bottomActual = bottomOffset.map(off => inner.maxR - off);
  const leftActual = leftOffset.map(off => inner.minC + off);
  const rightActual = rightOffset.map(off => inner.maxC - off);

  const output: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let r = bbox.minR; r <= bbox.maxR; r++) {
    for (let c = bbox.minC; c <= bbox.maxC; c++) {
      const ci = c - inner.minC;
      const ri = r - inner.minR;

      let inTopBottom: boolean;
      if (ci >= 0 && ci < innerWidth) {
        inTopBottom = r >= topActual[ci] && r <= bottomActual[ci];
      } else {
        inTopBottom = false;
      }

      let inLeftRight: boolean;
      if (ri >= 0 && ri < innerHeight) {
        inLeftRight = c >= leftActual[ri] && c <= rightActual[ri];
      } else {
        inLeftRight = false;
      }

      if (inTopBottom && inLeftRight) {
        output[r][c] = 1;
      }
    }
  }

  return output;
}

/**
 * 将退线后的形状（carved）以中心点为基准等比放大，放大到某条边刚好碰到目标 bbox
 * 轮廓时停止（不强制所有边贴边），保持原始形状比例不变。
 * 对目标 bbox 内每个像素，反向映射到 carved 的坐标系，最近邻采样。
 */
function scaleToFitBBox(
  carved: number[][],
  carvedBBox: Rect,
  targetBBox: Rect,
  rows: number,
  cols: number
): number[][] {
  const output: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  const cH = carvedBBox.maxR - carvedBBox.minR + 1;
  const cW = carvedBBox.maxC - carvedBBox.minC + 1;
  const tH = targetBBox.maxR - targetBBox.minR + 1;
  const tW = targetBBox.maxC - targetBBox.minC + 1;

  if (cH <= 0 || cW <= 0 || tH <= 0 || tW <= 0) return output;

  // 等比缩放：取高/宽两个方向中较小的缩放倍数，保证形状不变形
  // 某条边先碰到 target bbox 时停止，其余边不强制贴边
  const scaleR = tH / cH;
  const scaleC = tW / cW;
  const scale = Math.min(scaleR, scaleC); // 等比，取最小值防止溢出

  // 两个 bbox 的中心对齐
  const tCenterR = (targetBBox.minR + targetBBox.maxR) / 2;
  const tCenterC = (targetBBox.minC + targetBBox.maxC) / 2;
  const cCenterR = (carvedBBox.minR + carvedBBox.maxR) / 2;
  const cCenterC = (carvedBBox.minC + carvedBBox.maxC) / 2;

  // 放大后形状的实际 bbox 范围（用于确定绘制区域）
  const scaledHalfH = (cH * scale - 1) / 2;
  const scaledHalfW = (cW * scale - 1) / 2;
  const drawMinR = Math.round(tCenterR - scaledHalfH);
  const drawMaxR = Math.round(tCenterR + scaledHalfH);
  const drawMinC = Math.round(tCenterC - scaledHalfW);
  const drawMaxC = Math.round(tCenterC + scaledHalfW);

  for (let r = drawMinR; r <= drawMaxR; r++) {
    for (let c = drawMinC; c <= drawMaxC; c++) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      // 反向映射：目标像素 → carved 坐标系
      const srcR = Math.round(cCenterR + (r - tCenterR) / scale);
      const srcC = Math.round(cCenterC + (c - tCenterC) / scale);

      if (
        srcR >= 0 && srcR < rows &&
        srcC >= 0 && srcC < cols &&
        carved[srcR][srcC] === 1
      ) {
        output[r][c] = 1;
      }
    }
  }

  return output;
}

function processOneGrid(inputGrid: number[][], seedRaw: number): number[][] | null {
  const rows = inputGrid.length;
  const cols = inputGrid[0].length;
  const bbox = getBoundingBox(inputGrid);
  if (!bbox) return null;

  const seed = seedRaw === 0 ? Date.now() : seedRaw;
  const rand = mulberry32(seed);
  const { inner, setbacks } = applyLayer1(bbox, rand);

  // inner 过小时退化：直接输出原 bbox 填充形状，避免小地块消失
  if (inner.maxR - inner.minR < 2 || inner.maxC - inner.minC < 2) {
    const fallback: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let r = bbox.minR; r <= bbox.maxR; r++) {
      for (let c = bbox.minC; c <= bbox.maxC; c++) {
        fallback[r][c] = 1;
      }
    }
    return fallback;
  }

  // 第一步：生成两层退线结果
  const carved = applyLayer2(bbox, inner, setbacks, rand, rows, cols);

  // 第二步：计算退线结果的实际包围盒
  const carvedBBox = getBoundingBox(carved);
  if (!carvedBBox) return null;

  // 第三步：以中心点为基准放大，使包围盒与原始 bbox 对齐
  return scaleToFitBBox(carved, carvedBBox, bbox, rows, cols);
}

export function buildingCarve(input: Record<string, unknown>): Record<string, unknown> {
  const rawList = input.gridList ?? input.inputGrid;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;

  const gridList: number[][][] = Array.isArray(rawList)
    ? (Array.isArray(rawList[0]) && Array.isArray((rawList[0] as unknown[])[0])
        ? rawList as number[][][]
        : [rawList as number[][]])
    : [];

  if (gridList.length === 0) {
    return { error: "gridList is required and must be non-empty" };
  }

  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const outputGridList: number[][][] = gridList.map((grid, i) => {
    if (!grid || grid.length === 0 || !grid[0] || grid[0].length === 0) return [];
    const effectiveSeed = baseSeed + i * 999983;
    return processOneGrid(grid, effectiveSeed) ?? [];
  });

  return { outputGridList };
}
