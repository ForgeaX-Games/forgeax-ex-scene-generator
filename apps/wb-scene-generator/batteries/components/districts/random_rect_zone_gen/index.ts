/**
 * rectZoneGen: 在单张网格指定区域内随机生成不重叠矩形地块
 * 填充值自动取输入网格最大值+1，每个地块独立递增，全部写入同一张多值网格。
 *
 * DataTree 数据格式：输入 inputGrid 与输出 outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 *
 * 输入：inputGrid (grid); targetValue (number) — 目标区域掩码（0=任意非零）;
 *       count (number); minSize/maxSize (number) — 宽高范围（宽高各自独立随机，共用同一范围）;
 *       minDistance (number) — 相邻矩形最近边之间的最小格数间距;
 *       dispersion (number, 0–1) — 离散程度，越大越分散; seed (number)
 * 输出：outputGrid (grid) — 单张多值网格，每个地块一个递增 id;
 *       outputNameList (array) — [{id, name:'地块 N', type:'tile'}]，与网格中的 id 一一对应;
 *       placedCount (number) — 成功放置的矩形数量
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
  fillValue: number
): void {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      outputGrid[row][col] = fillValue;
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

  // 计算每个候选格到最近已放矩形中心的距离
  const weights = candidates.map(([cx, cy]) => {
    let minDist = Infinity;
    for (const [px, py] of placedCenters) {
      const d = Math.abs(cx - px) + Math.abs(cy - py);
      if (d < minDist) minDist = d;
    }
    // 线性插值：weight = lerp(1, minDist, dispersion)
    // dispersion=0 → weight=1（均匀），dispersion=1 → weight=minDist（距离越远越重）
    return 1 + (minDist - 1) * dispersion;
  });

  // 加权随机采样
  let total = 0;
  for (const w of weights) total += w;
  let r = rng.float() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/** 判断 v 是单张网格 number[][] */
function isGrid(v: unknown): v is number[][] {
  if (!Array.isArray(v) || v.length === 0) return false;
  const first = (v as unknown[])[0];
  if (!Array.isArray(first) || (first as unknown[]).length === 0) return false;
  return typeof (first as unknown[])[0] === "number";
}

/** 对单个网格执行矩形放置，写入同一张多值网格并返回名称清单 */
function processOneGrid(
  grid: number[][],
  targetValue: number,
  count: number,
  minSize: number,
  maxSize: number,
  minDistance: number,
  dispersion: number,
  maxAttempts: number,
  seed: number,
): { outputGrid: number[][]; nameList: { id: number; name: string; type: string }[]; placedCount: number } {
  const rows = grid.length;
  const cols = grid[0].length;
  const outputGrid: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  let maxVal = 0;
  for (const row of grid) for (const v of row) if (v > maxVal) maxVal = v;
  let nextFillValue = maxVal + 1;

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

  if (candidates.length === 0) return { outputGrid, nameList: [], placedCount: 0 };

  const placedCenters: [number, number][] = [];
  const placedRects: [number, number, number, number][] = []; // [x, y, w, h]
  const nameList: { id: number; name: string; type: string }[] = [];

  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const [anchorX, anchorY] = sampleAnchor(candidates, placedCenters, dispersion, rng);
      const w = minSize + rng.intn(maxSize - minSize + 1);
      const h = minSize + rng.intn(maxSize - minSize + 1);
      const x = anchorX - rng.intn(w);
      const y = anchorY - rng.intn(h);

      if (canPlace(grid, placedMask, x, y, w, h, rows, cols, targetValue, placedRects, minDistance)) {
        placeRect(outputGrid, placedMask, x, y, w, h, nextFillValue);
        nameList.push({ id: nextFillValue, name: `地块 ${nextFillValue}`, type: "tile" });
        placedCenters.push([x + w / 2, y + h / 2]);
        placedRects.push([x, y, w, h]);
        nextFillValue++;
        break;
      }
    }
  }

  return { outputGrid, nameList, placedCount: nameList.length };
}

export function rectZoneGen(input: Record<string, unknown>): Record<string, unknown> {
  const rawGrid = input.inputGrid;
  if (!isGrid(rawGrid)) {
    return { error: "inputGrid is required (number[][])" };
  }
  const grid = rawGrid as number[][];

  const targetValue = typeof input.targetValue === "number" ? Math.round(input.targetValue)                    : 0;
  const count       = typeof input.count       === "number" ? Math.max(1, Math.round(input.count))            : 5;
  const minSize     = typeof input.minSize     === "number" ? Math.max(1, Math.round(input.minSize))          : 13;
  const maxSize     = typeof input.maxSize     === "number" ? Math.max(minSize, Math.round(input.maxSize))    : 19;
  const minDistance = typeof input.minDistance === "number" ? Math.max(0, Math.round(input.minDistance))      : 2;
  const dispersion  = typeof input.dispersion  === "number" ? Math.max(0, Math.min(1, input.dispersion))      : 0.6;
  const maxAttempts = 1000;
  const seedRaw     = typeof input.seed        === "number" ? input.seed : 0;
  const baseSeed    = seedRaw === 0 ? Date.now() : seedRaw;

  const { outputGrid, nameList, placedCount } = processOneGrid(
    grid, targetValue, count, minSize, maxSize, minDistance, dispersion, maxAttempts, baseSeed,
  );

  return { outputGrid, outputNameList: nameList, placedCount };
}
