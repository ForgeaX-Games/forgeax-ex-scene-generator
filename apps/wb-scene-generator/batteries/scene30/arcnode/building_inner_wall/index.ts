/**
 * building_inner_wall: 使用BSP算法在建筑占地掩码内递归分割房间并绘制内墙
 * 输入：inputGrid (grid)  — 建筑占地掩码，非零值视为建筑内部
 *       density   (number) — 分割密度 0~1，控制递归深度，越大房间越多
 *       seed      (number) — 随机种子，0 使用当前时间戳
 * 输出：outputGrid (grid) — 内墙掩码，内墙=1，其余=0，内墙宽度恒为1
 *
 * 约束：
 *   - 内墙不贴合外墙（内墙距边界至少1格）
 *   - 平行墙体之间距离至少为2
 *   - 最小房间长宽均 >= 2（分割后每侧净空间 >= 2）
 *   - 房间大小分布均匀：优先在中间区域随机分割
 */

/** 房间矩形，坐标均为"内部可用区域"的行列索引（相对于整个grid） */
interface Room {
  r0: number; // 顶行（包含）
  c0: number; // 左列（包含）
  r1: number; // 底行（包含）
  c1: number; // 右列（包含）
}

/** 简单线性同余随机数生成器，避免依赖 Math.random */
function makeLCG(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = Date.now() >>> 0;
  return function () {
    // Park-Miller LCG，结果在 [0, 1)
    s = Math.imul(1664525, s) + 1013904223;
    s = s >>> 0;
    return s / 0x100000000;
  };
}

/**
 * 在 [lo, hi] 范围内选一个"靠近中点"的随机分割位置。
 * 分割点 p 满足：lo+1 <= p <= hi-1（两侧各留至少1格），
 * 且从 [center-range, center+range] 区间内均匀采样，使房间大小更均匀。
 * 返回 -1 表示无法分割。
 */
function pickSplit(lo: number, hi: number, rand: () => number): number {
  // 两侧净空间至少为2：lo+2 <= p <= hi-2（p是墙位置，墙两侧各有>=2格空间）
  // lo..p-1 为左侧/上侧房间（净宽 = p-lo >= 2 => p >= lo+2）
  // p+1..hi 为右侧/下侧房间（净宽 = hi-p >= 2 => p <= hi-2）
  const minP = lo + 2;
  const maxP = hi - 2;
  if (minP > maxP) return -1;

  // 在 [minP, maxP] 内靠近中点的40%区间随机取
  const center = (minP + maxP) / 2;
  const halfRange = Math.max(1, Math.floor((maxP - minP) * 0.4));
  const rangeMin = Math.max(minP, Math.floor(center - halfRange));
  const rangeMax = Math.min(maxP, Math.ceil(center + halfRange));

  return rangeMin + Math.floor(rand() * (rangeMax - rangeMin + 1));
}

/**
 * BSP递归分割
 * @param room      当前房间的内部可用区域（排除外墙后的坐标）
 * @param depth     当前递归深度
 * @param maxDepth  最大递归深度
 * @param rand      随机数生成器
 * @param walls     输出的墙体坐标集（grid坐标）
 * @param cols      grid列数
 * @param inputGrid 原始建筑掩码，用于确定实际建筑边界
 */
function bspSplit(
  room: Room,
  depth: number,
  maxDepth: number,
  rand: () => number,
  walls: Set<number>,
  cols: number,
  inputGrid: number[][]
): void {
  if (depth >= maxDepth) return;

  const height = room.r1 - room.r0 + 1;
  const width  = room.c1 - room.c0 + 1;

  // 能否水平/垂直分割：分割后两侧净空间各需 >= 2
  // 即该方向尺寸 >= 2+1+2 = 5（两侧2格 + 1格墙）
  const canH = height >= 5;
  const canV = width  >= 5;

  if (!canH && !canV) return;

  // 决定分割方向：优先在较长轴，相近时随机
  let splitH: boolean;
  if (canH && !canV) {
    splitH = true;
  } else if (canV && !canH) {
    splitH = false;
  } else {
    // 两者都可以：偏向较长轴，差距 <= 20% 时随机
    const ratio = height / width;
    if (ratio > 1.2) splitH = true;
    else if (ratio < 0.83) splitH = false;
    else splitH = rand() < 0.5;
  }

  if (splitH) {
    // 水平分割：在 room.r0 .. room.r1 之间选一行作为墙
    const p = pickSplit(room.r0, room.r1, rand);
    if (p === -1) return;

    // 绘制水平墙：沿第 p 行从 room.c0 到 room.c1
    // 对于非矩形建筑，墙必须延伸到实际建筑内壁，
    // 因此向两侧各扩展1格（抵达外墙格子），再截断到建筑边界
    const wallCStart = room.c0 - 1;
    const wallCEnd   = room.c1 + 1;
    for (let c = wallCStart; c <= wallCEnd; c++) {
      if (inputGrid[p] && inputGrid[p][c] !== 0) {
        walls.add(p * cols + c);
      }
    }

    // 递归处理上下两个子房间
    bspSplit({ r0: room.r0, c0: room.c0, r1: p - 1, c1: room.c1 }, depth + 1, maxDepth, rand, walls, cols, inputGrid);
    bspSplit({ r0: p + 1, c0: room.c0, r1: room.r1, c1: room.c1 }, depth + 1, maxDepth, rand, walls, cols, inputGrid);
  } else {
    // 垂直分割：在 room.c0 .. room.c1 之间选一列作为墙
    const p = pickSplit(room.c0, room.c1, rand);
    if (p === -1) return;

    // 绘制垂直墙：沿第 p 列从 room.r0 到 room.r1
    // 向两侧各扩展1格（抵达外墙格子），再截断到建筑边界
    const wallRStart = room.r0 - 1;
    const wallREnd   = room.r1 + 1;
    for (let r = wallRStart; r <= wallREnd; r++) {
      if (inputGrid[r] && inputGrid[r][p] !== 0) {
        walls.add(r * cols + p);
      }
    }

    // 递归处理左右两个子房间
    bspSplit({ r0: room.r0, c0: room.c0, r1: room.r1, c1: p - 1 }, depth + 1, maxDepth, rand, walls, cols, inputGrid);
    bspSplit({ r0: room.r0, c0: p + 1, r1: room.r1, c1: room.c1 }, depth + 1, maxDepth, rand, walls, cols, inputGrid);
  }
}

/**
 * 计算建筑内部连通区域的轴对齐包围盒（AABB）。
 * 取距外边界至少1格的内缩区域作为BSP可用区域。
 */
function computeInnerBounds(
  grid: number[][],
  rows: number,
  cols: number
): Room | null {
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

  // 内缩1格以确保内墙不贴合外墙
  const r0 = minR + 1;
  const r1 = maxR - 1;
  const c0 = minC + 1;
  const c1 = maxC - 1;

  if (r0 > r1 || c0 > c1) return null;
  return { r0, r1, c0, c1 };
}

/**
 * 将 density 映射到最大递归深度。
 * density 0   => maxDepth 0（不分割）
 * density 0.5 => maxDepth ~3
 * density 1.0 => maxDepth 6
 */
function densityToMaxDepth(density: number): number {
  const clamped = Math.max(0, Math.min(1, density));
  return Math.round(clamped * 6);
}

function processOneGrid(inputGrid: number[][], density: number, seedRaw: number): number[][] {
  const rows = inputGrid.length;
  const cols = inputGrid[0].length;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;
  const rand = makeLCG(seed);
  const outputGrid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  const innerBounds = computeInnerBounds(inputGrid, rows, cols);
  if (!innerBounds) return outputGrid;

  const maxDepth = densityToMaxDepth(density);
  if (maxDepth === 0) return outputGrid;

  const walls = new Set<number>();
  bspSplit(innerBounds, 0, maxDepth, rand, walls, cols, inputGrid);

  for (const key of walls) {
    const r = Math.floor(key / cols);
    const c = key % cols;
    if (r >= 0 && r < rows && c >= 0 && c < cols && inputGrid[r][c] !== 0) {
      outputGrid[r][c] = 1;
    }
  }
  return outputGrid;
}

export function buildingInnerWall(input: Record<string, unknown>): Record<string, unknown> {
  const rawList = input.gridList ?? input.inputGrid;
  const density = typeof input.density === "number" ? input.density : 0.4;
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
    return processOneGrid(grid, density, effectiveSeed);
  });

  return { outputGridList };
}
