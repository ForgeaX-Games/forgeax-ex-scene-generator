/**
 * bspRectGen: 以中心点为锚，在单张网格区域内向外播撒一片紧凑的 BSP 矩形地块
 *
 * DataTree 数据格式：输入 inputGrid 与输出 outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 *
 * 核心策略：
 *   1. 对 bounding box 做 BSP 分割，得到候选矩形列表
 *   2. 按距中心点距离排序，从近到远依次处理
 *   3. 每个候选矩形：原位合法直接放入，否则就近吸附到最近合法锚点
 *   4. 所有地块写入同一张多值网格（每个地块一个递增 id）
 */

interface Rect { x: number; y: number; w: number; h: number; }
interface NameEntry { id: number; name: string; type: string; }

/** 判断 v 是单张网格 number[][] */
function isGrid(v: unknown): v is number[][] {
  if (!Array.isArray(v) || v.length === 0) return false;
  const first = (v as unknown[])[0];
  if (!Array.isArray(first) || (first as unknown[]).length === 0) return false;
  return typeof (first as unknown[])[0] === "number";
}

// ─── LCG RNG ──────────────────────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = (seed === 0 ? Date.now() : seed) >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223;
    return (s >>> 0) / 0x100000000;
  };
}

// ─── 九宫格坐标解析 ───────────────────────────────────────────────────────────

function gridPositionToNorm(pos: number): { nx: number; ny: number } {
  const p = Math.max(1, Math.min(9, Math.round(pos)));
  const col = (p - 1) % 3;
  const row = Math.floor((p - 1) / 3);
  const margin = 0.2;
  return {
    nx: margin + (col / 2) * (1 - 2 * margin),
    ny: margin + (row / 2) * (1 - 2 * margin),
  };
}

// ─── BSP 分割 ─────────────────────────────────────────────────────────────────

function bspSplitAll(
  rect: Rect,
  minSize: number,
  maxSize: number,
  splitRatio: number,
  rng: () => number,
): Rect[] {
  const { x, y, w, h } = rect;

  const overMaxW = maxSize > 0 && w > maxSize;
  const overMaxH = maxSize > 0 && h > maxSize;
  const canH = h >= minSize * 2 + 1;
  const canV = w >= minSize * 2 + 1;

  if (!canH && !canV) return [rect];

  let splitHoriz: boolean;
  if (overMaxH && !overMaxW && canH) {
    splitHoriz = true;
  } else if (overMaxW && !overMaxH && canV) {
    splitHoriz = false;
  } else if (overMaxH && overMaxW) {
    splitHoriz = canH && (!canV || h >= w);
  } else {
    splitHoriz = canH && (!canV || (h >= w ? rng() < 0.65 : rng() < 0.35));
  }

  if (splitHoriz && canH) {
    const lo = minSize;
    const hi = h - minSize - 1;
    if (lo > hi) return [rect];
    const range = hi - lo;
    const cut = Math.floor(lo + range * (splitRatio + rng() * (1 - 2 * splitRatio)));
    return [
      ...bspSplitAll({ x, y,             w, h: cut         }, minSize, maxSize, splitRatio, rng),
      ...bspSplitAll({ x, y: y + cut + 1, w, h: h - cut - 1 }, minSize, maxSize, splitRatio, rng),
    ];
  } else if (canV) {
    const lo = minSize;
    const hi = w - minSize - 1;
    if (lo > hi) return [rect];
    const range = hi - lo;
    const cut = Math.floor(lo + range * (splitRatio + rng() * (1 - 2 * splitRatio)));
    return [
      ...bspSplitAll({ x,             y, w: cut,         h }, minSize, maxSize, splitRatio, rng),
      ...bspSplitAll({ x: x + cut + 1, y, w: w - cut - 1, h }, minSize, maxSize, splitRatio, rng),
    ];
  }

  return [rect];
}

// ─── 矩形中心到目标点的距离 ───────────────────────────────────────────────────

function rectCenterDist(rect: Rect, px: number, py: number): number {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
}

// ─── 越界检测与平移修正 ───────────────────────────────────────────────────────

/** 检查矩形是否完全在掩码内 */
function isRectInMask(rect: Rect, mask: boolean[][], rows: number, cols: number): boolean {
  for (let r = rect.y; r < rect.y + rect.h; r++) {
    for (let c = rect.x; c < rect.x + rect.w; c++) {
      if (r < 0 || r >= rows || c < 0 || c >= cols || !mask[r][c]) return false;
    }
  }
  return true;
}

/**
 * 在掩码中寻找能放下 w×h 矩形的所有合法锚点（左上角），
 * 返回离目标中心最近的那个。
 *
 * 算法：对每列预计算向上连续 true 的高度（直方图），
 * 然后用滑动窗口在每行找宽度≥w、高度≥h 的区域。
 * 时间复杂度 O(rows × cols)。
 */
function findNearestAnchor(
  w: number,
  h: number,
  mask: boolean[][],
  rows: number,
  cols: number,
  cx: number,
  cy: number,
): { x: number; y: number } | null {
  // heights[c] = 从第 r 行向上（含 r）连续为 true 的格数
  const heights = new Array(cols).fill(0);
  let best: { x: number; y: number } | null = null;
  let bestDist = Infinity;

  for (let r = 0; r < rows; r++) {
    // 更新列高度
    for (let c = 0; c < cols; c++) {
      heights[c] = mask[r][c] ? heights[c] + 1 : 0;
    }

    if (r < h - 1) continue; // 行数不够 h，跳过

    // 滑动窗口：宽度为 w 的窗口内，所有列高度都 ≥ h
    // 用单调队列维护窗口最小值
    const deque: number[] = []; // 存列索引，队首为窗口最小高度对应列
    for (let c = 0; c < cols; c++) {
      // 移除不满足高度的尾部
      while (deque.length > 0 && heights[deque[deque.length - 1]] >= heights[c]) {
        deque.pop();
      }
      deque.push(c);

      // 移除超出窗口的队首
      if (deque[0] < c - w + 1) deque.shift();

      // 窗口已满足宽度 w
      if (c >= w - 1) {
        const minH = heights[deque[0]];
        if (minH >= h) {
          // 这个窗口 [c-w+1, c] 的第 r 行向上 h 行都合法
          const anchorX = c - w + 1;
          const anchorY = r - h + 1;
          // 矩形中心坐标
          const rcx = anchorX + w / 2;
          const rcy = anchorY + h / 2;
          const dist = (rcx - cx) ** 2 + (rcy - cy) ** 2;
          if (dist < bestDist) {
            bestDist = dist;
            best = { x: anchorX, y: anchorY };
          }
        }
      }
    }
  }

  return best;
}

/**
 * 尝试将矩形放入掩码内。
 * 策略：先检查原位是否合法；不合法则在全掩码范围内
 * 寻找离原矩形中心最近的合法锚点，直接跳过去。
 */
function tryFitInMask(
  rect: Rect,
  mask: boolean[][],
  rows: number,
  cols: number,
): Rect | null {
  if (isRectInMask(rect, mask, rows, cols)) return rect;

  // 矩形尺寸超出掩码范围，直接放弃
  if (rect.w > cols || rect.h > rows) return null;

  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;

  const anchor = findNearestAnchor(rect.w, rect.h, mask, rows, cols, cx, cy);
  if (!anchor) return null;

  return { x: anchor.x, y: anchor.y, w: rect.w, h: rect.h };
}

// ─── 主处理函数 ───────────────────────────────────────────────────────────────

function processOneGrid(
  inputGrid: number[][],
  centerPos: number,
  centerPoint: { x: number; y: number } | null,
  targetCount: number,
  minSize: number,
  maxSize: number,
  splitRatio: number,
  seed: number,
): { outputGrid: number[][]; outputNameList: NameEntry[] } {
  const rows = inputGrid.length;
  const cols = inputGrid[0]?.length ?? 0;
  const emptyGrid = (): number[][] => Array.from({ length: rows }, () => new Array(cols).fill(0));
  if (cols === 0) return { outputGrid: emptyGrid(), outputNameList: [] };

  const rng = makeRng(seed);

  let minX = cols, minY = rows, maxX = -1, maxY = -1;
  const mask: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (inputGrid[r][c] !== 0) {
        mask[r][c] = true;
        if (c < minX) minX = c;
        if (c > maxX) maxX = c;
        if (r < minY) minY = r;
        if (r > maxY) maxY = r;
      }
    }
  }

  if (maxX < 0) return { outputGrid: emptyGrid(), outputNameList: [] };

  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;

  // 中心定位：优先用显式 point2d（x→列, y→行，裁剪到 bbox 内）；
  // 否则回退九宫格 centerPos；centerPos 越界时随机。
  let centerX: number;
  let centerY: number;
  if (centerPoint && Number.isFinite(centerPoint.x) && Number.isFinite(centerPoint.y)) {
    centerX = Math.min(maxX, Math.max(minX, centerPoint.x));
    centerY = Math.min(maxY, Math.max(minY, centerPoint.y));
  } else {
    const norm = (centerPos >= 1 && centerPos <= 9)
      ? gridPositionToNorm(centerPos)
      : { nx: 0.1 + rng() * 0.8, ny: 0.1 + rng() * 0.8 };
    centerX = minX + norm.nx * (bboxW - 1);
    centerY = minY + norm.ny * (bboxH - 1);
  }

  // BSP 对 bounding box 分割，生成候选矩形
  const root: Rect = { x: minX, y: minY, w: bboxW, h: bboxH };
  const allRects = bspSplitAll(root, minSize, maxSize, splitRatio, rng);
  allRects.sort((a, b) => rectCenterDist(a, centerX, centerY) - rectCenterDist(b, centerX, centerY));

  const outputGrid: number[][] = emptyGrid();
  const outputNameList: NameEntry[] = [];
  let parcelId = 1;

  for (const rect of allRects) {
    if (parcelId > targetCount) break;

    // 尝试将矩形放入掩码内（原位合法直接用，否则找最近合法锚点）
    const fitted = tryFitInMask(rect, mask, rows, cols);
    if (!fitted) continue;

    // 写入同一张多值网格，每个地块一个递增 id（重叠时后写入的覆盖）
    for (let r = fitted.y; r < fitted.y + fitted.h; r++) {
      for (let c = fitted.x; c < fitted.x + fitted.w; c++) {
        outputGrid[r][c] = parcelId;
      }
    }

    outputNameList.push({ id: parcelId, name: `地块 ${parcelId}`, type: "tile" });
    parcelId++;
  }

  return { outputGrid, outputNameList };
}

// ─── 主导出函数 ───────────────────────────────────────────────────────────────

export function bspRectGen(input: Record<string, unknown>): Record<string, unknown> {
  const rawGrid = input.inputGrid;
  if (!isGrid(rawGrid)) {
    return { error: "inputGrid is required (number[][])" };
  }
  const grid = rawGrid as number[][];

  const centerPos   = typeof input.centerPosition === "number" ? Math.round(input.centerPosition) : 5;
  const centerPoint = parsePoint(input.centerPoint);
  const targetCount = clampInt(input.targetCount, 1, 5000, 10);
  const minSize     = clampInt(input.minSize,     1, 500,  4);
  const maxSizeRaw  = clampInt(input.maxSize,     0, 2000, 12);
  const maxSize     = maxSizeRaw === 0 ? 0 : Math.max(minSize, maxSizeRaw);
  const splitRatio  = clampFloat(input.splitRatio, 0.1, 0.49, 0.35);
  const seedRaw     = typeof input.seed === "number" ? Math.round(input.seed) : 0;

  const { outputGrid, outputNameList } = processOneGrid(
    grid, centerPos, centerPoint, targetCount, minSize, maxSize, splitRatio, seedRaw,
  );

  return { outputGrid, outputNameList };
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** 解析 point2d 输入 {x,y}（x→列, y→行）；非法返回 null */
function parsePoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== "object") return null;
  const p = value as { x?: unknown; y?: unknown };
  const x = Number(p.x);
  const y = Number(p.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}
