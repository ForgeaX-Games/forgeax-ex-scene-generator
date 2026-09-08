/**
 * randomRectZoneGen: 在网格目标区域内随机生成不重叠矩形地块，
 * 每个地块输出为一张独立的 0/1 网格（地块覆盖的格子=1）。
 *
 * 输入：grid (grid) — 输入二维网格；
 *       targetValue (number) — 0 视为任意非零格（特征函数=1），非 0 精确匹配掩码 ID;
 *       count (number) — 目标矩形数量;
 *       minSize / maxSize (number) — 宽高范围（宽高各自独立随机，共用此范围）;
 *       minDistance (number) — 相邻矩形最近边的最小格距;
 *       dispersion (number, 0–1) — 离散程度，越大越分散;
 *       seed (number)
 * 输出：outputGridList (grid[], rank=1) — 每个地块一张独立 0/1 网格;
 *       placedCount (number) — 实际放置数量
 *
 * 算法本体（LCG / sampleAnchor / hasMinDistance / canPlace / placeRect）
 * 直接照搬自老版本 components/districts/random_rect_zone_gen，
 * 仅作格式适配：去掉双形态输入解析、去掉 merge 分支与名称清单、
 * fillValue 改为常量 1；列表 fanout 由外层 autoIterate 处理。
 */

class LCG {
  private s: bigint;
  constructor(seed: number) { this.s = BigInt(seed || 12345); }
  next(): bigint {
    this.s = (this.s * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
    return this.s;
  }
  float(): number { return Number(this.next() & 0xFFFFFFFFn) / 0x100000000; }
  intn(n: number): number { return n <= 0 ? 0 : Number(this.next() % BigInt(n)); }
}

/**
 * 检查矩形 [x, x+w) × [y, y+h) 是否与所有已放矩形保持最小边距。
 * 最近边距离定义：两矩形在 X 轴上的单侧间隙（gapX）和 Y 轴上的单侧间隙（gapY），
 * 取两轴中较小的正间隙作为最近边距离。若任意一轴重叠（间隙 < 0），
 * 则仅看另一轴是否满足最小距离要求。
 * 即：只要 max(gapX,0) < minDistance 且 max(gapY,0) < minDistance，则距离不足。
 */
function hasMinDistance(
  x: number, y: number, w: number, h: number,
  placedRects: [number, number, number, number][],
  minDistance: number,
): boolean {
  if (minDistance <= 0) return true;
  for (const [px, py, pw, ph] of placedRects) {
    const gapX = Math.max(px - (x + w), x - (px + pw));
    const gapY = Math.max(py - (y + h), y - (py + ph));
    if (Math.max(gapX, 0) < minDistance && Math.max(gapY, 0) < minDistance) return false;
  }
  return true;
}

function canPlace(
  grid: number[][],
  placedMask: boolean[][],
  x: number,
  y: number,
  w: number,
  h: number,
  rows: number,
  cols: number,
  targetValue: number,
  placedRects: [number, number, number, number][],
  minDistance: number,
): boolean {
  if (x < 0 || y < 0 || x + w > cols || y + h > rows) return false;
  if (!hasMinDistance(x, y, w, h, placedRects, minDistance)) return false;
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      const v = grid[row][col];
      if (targetValue === 0 ? v === 0 : v !== targetValue) return false;
      if (placedMask[row][col]) return false;
    }
  }
  return true;
}

function placeRect(
  outputGrid: number[][],
  placedMask: boolean[][],
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      outputGrid[row][col] = 1;
      placedMask[row][col] = true;
    }
  }
}

/**
 * 基于离散程度加权采样锚点。
 * dispersion=0：纯均匀随机（与已放矩形的距离无关）
 * dispersion=1：完全按"距最近已放矩形中心的距离"正比加权，距离越远被选中概率越高
 * 中间值线性插值。
 * 若还没有已放矩形，退化为均匀随机。
 */
function sampleAnchor(
  candidates: [number, number][],
  placedCenters: [number, number][],
  dispersion: number,
  rng: LCG
): [number, number] {
  if (dispersion <= 0 || placedCenters.length === 0) {
    return candidates[rng.intn(candidates.length)];
  }

  const weights = candidates.map(([cx, cy]) => {
    let minDist = Infinity;
    for (const [px, py] of placedCenters) {
      const d = Math.abs(cx - px) + Math.abs(cy - py);
      if (d < minDist) minDist = d;
    }
    // 线性插值：weight = lerp(1, minDist, dispersion)
    return 1 + (minDist - 1) * dispersion;
  });

  let total = 0;
  for (const w of weights) total += w;
  let r = rng.float() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

export function randomRectZoneGen(input: Record<string, unknown>): Record<string, unknown> {
  const grid = input.grid as number[][] | undefined;
  if (!grid || grid.length === 0 || (grid[0]?.length ?? 0) === 0) {
    return { error: "grid is required" };
  }

  const rows = grid.length;
  const cols = grid[0].length;

  const targetValue = typeof input.targetValue === "number" ? Math.round(input.targetValue)               : 0;
  const count       = typeof input.count       === "number" ? Math.max(1, Math.round(input.count))       : 5;
  const minSize     = typeof input.minSize     === "number" ? Math.max(1, Math.round(input.minSize))     : 13;
  const maxSize     = typeof input.maxSize     === "number" ? Math.max(minSize, Math.round(input.maxSize)) : 19;
  const minDistance = typeof input.minDistance === "number" ? Math.max(0, Math.round(input.minDistance)) : 2;
  const dispersion  = typeof input.dispersion  === "number" ? Math.max(0, Math.min(1, input.dispersion)) : 0.6;
  const seedRaw     = typeof input.seed        === "number" ? input.seed : 0;
  const seed        = seedRaw === 0 ? Date.now() : seedRaw;
  const maxAttempts = 1000;

  const rng = new LCG(seed);
  const placedMask: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));

  const candidates: [number, number][] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const v = grid[row][col];
      const valid = targetValue === 0 ? v !== 0 : v === targetValue;
      if (valid) candidates.push([col, row]);
    }
  }

  if (candidates.length === 0) {
    return { outputGridList: [], placedCount: 0 };
  }

  const placedCenters: [number, number][] = [];
  const placedRects: [number, number, number, number][] = []; // [x, y, w, h]
  const outputGridList: number[][][] = [];

  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const [anchorX, anchorY] = sampleAnchor(candidates, placedCenters, dispersion, rng);
      const w = minSize + rng.intn(maxSize - minSize + 1);
      const h = minSize + rng.intn(maxSize - minSize + 1);
      const x = anchorX - rng.intn(w);
      const y = anchorY - rng.intn(h);

      if (canPlace(grid, placedMask, x, y, w, h, rows, cols, targetValue, placedRects, minDistance)) {
        const rectGrid: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
        placeRect(rectGrid, placedMask, x, y, w, h);
        outputGridList.push(rectGrid);
        placedCenters.push([x + w / 2, y + h / 2]);
        placedRects.push([x, y, w, h]);
        break;
      }
    }
  }

  return { outputGridList, placedCount: outputGridList.length };
}
