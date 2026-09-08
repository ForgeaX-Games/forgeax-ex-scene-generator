/**
 * building_setback: 对输入 grid 非零区域的包围盒执行两层建筑退线，输出建筑占地 mask（1=建筑，0=外部）
 *
 * 输入：inputGrid (grid) — 源网格，非零像素的包围盒作为建筑矩形
 *       seed (number) — 随机种子，0 使用时间戳
 * 输出：outputGrid (grid) — 同尺寸网格，建筑区域=1，其余=0
 *
 * 算法分两层：
 * 第一层：四条边各自独立从 {1,2,3,4} 按权重 90:70:50:40 随机采样退线量，向内缩减包围盒
 * 第二层：对每条边按长度分成 3-6 段，每段以受第一层退线量调制的概率决定是否再退线
 *         - 第一层退少（1格）的边：第二层80%概率向内退，10%概率向外突
 *         - 第一层退多（4格）的边：第二层20%概率向内退，2%概率向外突
 *         退线/突出量均为1格，外突不超过原始包围盒边界
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

// 从候选值中按权重随机采样
function weightedSample(rand: () => number, values: number[], weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < values.length; i++) {
    r -= weights[i];
    if (r <= 0) return values[i];
  }
  return values[values.length - 1];
}

// 取输入 grid 非零像素包围盒
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

// 第一层：对包围盒四边各自独立采样退线量
// 返回经第一层退线后的内框，以及各边实际退线量
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

  // 防止退线超过矩形尺寸，至少保留1格
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

// 计算第二层某条边的 内退/外突 概率，由第一层退线量调制
// 第一层退线量越大（退了很多）→ 第二层内退概率越小，外突概率也越小
// 第一层退线量越小（退了很少）→ 第二层内退概率越大
function layer2Probs(setback: number): { inwardProb: number; outwardProb: number } {
  // setback ∈ {1,2,3,4}，线性插值
  // setback=1: inward=0.80, outward=0.10
  // setback=4: inward=0.20, outward=0.02
  const t = (setback - 1) / 3; // 0..1
  const inwardProb = 0.80 - t * (0.80 - 0.20);
  const outwardProb = 0.10 - t * (0.10 - 0.02);
  return { inwardProb, outwardProb };
}

// 按边长决定分段数：每段目标长度约 7 格，最少 1 段，最多 6 段
// 例：边长 7 → 1 段；8~14 → 2 段；15~21 → 3 段；22~28 → 4 段
function segmentCount(length: number): number {
  return Math.min(6, Math.max(1, Math.ceil(length / 7)));
}

// 将长度为 len 的边均匀分成 n 段，返回每段的 [start, end) 范围
// 使用整数分配（前 len%n 段多1格），保证各段长度差不超过1
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

// 第二层：在第一层内框基础上，对每条边分段退线，生成最终建筑 mask
//
// 策略：用一张二维 mask 直接绘制，每条边独立操作自己负责的"带状区域"。
// 每条边的分段退线只修改该边方向上的偏移量数组，最终按偏移量逐像素填充。
// 这样避免了四个一维数组交叉判断时角落区域的歧义。
//
// 各边负责的带状区域（外突时向原始包围盒方向扩展，不超过 bbox 边界）：
//   top:    列方向 [inner.minC, inner.maxC]，行方向从 bbox.minR 到 inner.maxR
//   bottom: 列方向 [inner.minC, inner.maxC]，行方向从 inner.minR 到 bbox.maxR
//   left:   行方向 [inner.minR, inner.maxR]，列方向从 bbox.minC 到 inner.maxC
//   right:  行方向 [inner.minR, inner.maxR]，列方向从 inner.minC 到 bbox.maxC
//
// 先用各边偏移量数组生成四张"边带 mask"，再取四张 mask 的交集得到最终形状。
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

  // 每条边的分段偏移量（相对 inner 边界的偏移，正=向内退，负=向外突）
  // topOffset[i]    对应列索引 inner.minC+i，正值表示 top 边界下移（内退）
  // bottomOffset[i] 对应列索引 inner.minC+i，正值表示 bottom 边界上移（内退）
  // leftOffset[i]   对应行索引 inner.minR+i，正值表示 left 边界右移（内退）
  // rightOffset[i]  对应行索引 inner.minR+i，正值表示 right 边界左移（内退）
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

    const maxOutward = side === "top" ? setbacks.top
      : side === "bottom" ? setbacks.bottom
      : side === "left" ? setbacks.left
      : setbacks.right;

    for (const [segStart, segEnd] of segments) {
      const rv = rand();
      let direction = 0; // +1=内退, -1=外突, 0=不动
      if (rv < inwardProb) {
        direction = 1;
      } else if (rv < inwardProb + outwardProb) {
        direction = -1;
      }
      if (direction === 0) continue;

      // 再抽一次决定幅度：内退 70%→1格 30%→2格；外突 80%→1格 20%→2格
      const rv2 = rand();
      let magnitude: number;
      if (direction > 0) {
        magnitude = rv2 < 0.70 ? 1 : 2;
      } else {
        // 外突2格需要第一层退线量≥2才有空间
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

  // 根据四个偏移量数组计算各边实际边界行/列
  // topActual[i]:    列 inner.minC+i 的建筑上边界行号
  // bottomActual[i]: 列 inner.minC+i 的建筑下边界行号
  // leftActual[i]:   行 inner.minR+i 的建筑左边界列号
  // rightActual[i]:  行 inner.minR+i 的建筑右边界列号
  const topActual = topOffset.map((off, i) => {
    void i;
    return inner.minR + off;  // off>0 下移（内退），off<0 上移（外突）
  });
  const bottomActual = bottomOffset.map((off, i) => {
    void i;
    return inner.maxR - off;  // off>0 上移（内退），off<0 下移（外突）
  });
  const leftActual = leftOffset.map((off, i) => {
    void i;
    return inner.minC + off;
  });
  const rightActual = rightOffset.map((off, i) => {
    void i;
    return inner.maxC - off;
  });

  const output: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  // 填充：只遍历可能有效的区域（bbox 范围）
  for (let r = bbox.minR; r <= bbox.maxR; r++) {
    for (let c = bbox.minC; c <= bbox.maxC; c++) {
      // 将 r, c 转换为偏移量数组的索引
      const ci = c - inner.minC; // 列在 inner 中的偏移
      const ri = r - inner.minR; // 行在 inner 中的偏移

      // 判断该像素是否在 top/bottom 约束范围内
      // 只有 ci 在 [0, innerWidth) 范围内才有有效的 top/bottom 边界
      let inTopBottom: boolean;
      if (ci >= 0 && ci < innerWidth) {
        inTopBottom = r >= topActual[ci] && r <= bottomActual[ci];
      } else {
        // 超出 inner 列范围的像素（不应出现在最终形状中）
        inTopBottom = false;
      }

      // 判断该像素是否在 left/right 约束范围内
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

function processOneGrid(inputGrid: number[][], seedRaw: number): number[][] | null {
  const rows = inputGrid.length;
  const cols = inputGrid[0].length;
  const bbox = getBoundingBox(inputGrid);
  if (!bbox) return null;

  const seed = seedRaw === 0 ? Date.now() : seedRaw;
  const rand = mulberry32(seed);
  const { inner, setbacks } = applyLayer1(bbox, rand);
  if (inner.maxR - inner.minR < 2 || inner.maxC - inner.minC < 2) return null;
  return applyLayer2(bbox, inner, setbacks, rand, rows, cols);
}

export function buildingProfile(input: Record<string, unknown>): Record<string, unknown> {
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
