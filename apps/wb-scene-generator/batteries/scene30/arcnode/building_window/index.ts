/**
 * building_window: 在墙体网格中随机打开窗洞
 * 输入：wallGrid      (grid)   — 墙体掩码，非零值为墙
 *       windowCount   (number) — 窗的数量
 *       windowWidth   (number) — 窗宽（格子数），沿墙方向连续清除
 *       randomEnable  (bool)   — 是否随机开启；关闭时按均匀间距分配窗洞
 *       seed          (number) — 随机种子，0 使用当前时间戳
 * 输出：outputGrid    (grid)   — 打好窗洞的墙体掩码，窗洞处=0
 *       windowGrid    (grid)   — 仅标记窗洞的掩码，窗洞处=1，其余=0
 *
 * 算法思路：
 *   1. 扫描所有"可开窗的墙格"：该格是墙，且沿某轴方向连续 windowWidth 格均为墙，
 *      且该段两侧（垂直于墙方向）同时有非墙区域——即必须"内外都是空"才是窗
 *      （区别于门只需一侧是空）。
 *   2. randomEnable=true：Fisher-Yates 打乱候选集，顺序选取不重叠的段。
 *      randomEnable=false：将候选集按位置排序后均匀间隔抽取。
 *   3. 两个窗洞之间（沿同方向）保留至少 1 格间距，防止窗洞紧贴。
 */

/** 简单线性同余随机数生成器 */
function makeLCG(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = Date.now() >>> 0;
  return function () {
    s = Math.imul(1664525, s) + 1013904223;
    s = s >>> 0;
    return s / 0x100000000;
  };
}

/** Fisher-Yates 洗牌，原地打乱数组 */
function shuffle<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/** 候选窗洞：起点(r,c)、方向、宽度 */
interface WindowCandidate {
  r: number;
  c: number;
  dir: "H" | "V";
  width: number;
}

/**
 * 收集所有合法的候选窗洞
 * 与门不同：窗要求段的两侧（垂直方向）都有空格，表示墙是内外之间的墙体
 */
function collectCandidates(
  grid: number[][],
  rows: number,
  cols: number,
  windowWidth: number
): WindowCandidate[] {
  const candidates: WindowCandidate[] = [];

  // 水平方向：固定行，沿列连续 windowWidth 格均为墙
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols - windowWidth; c++) {
      let allWall = true;
      for (let dc = 0; dc < windowWidth; dc++) {
        if (grid[r][c + dc] === 0) { allWall = false; break; }
      }
      if (!allWall) continue;

      // 窗要求上方 AND 下方都有空格（表示两侧贯通）
      const hasTop    = r > 0       && grid[r - 1][c] === 0;
      const hasBottom = r < rows - 1 && grid[r + 1][c] === 0;
      if (hasTop && hasBottom) {
        candidates.push({ r, c, dir: "H", width: windowWidth });
      }
    }
  }

  // 垂直方向：固定列，沿行连续 windowWidth 格均为墙
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r <= rows - windowWidth; r++) {
      let allWall = true;
      for (let dr = 0; dr < windowWidth; dr++) {
        if (grid[r + dr][c] === 0) { allWall = false; break; }
      }
      if (!allWall) continue;

      // 窗要求左方 AND 右方都有空格
      const hasLeft  = c > 0       && grid[r][c - 1] === 0;
      const hasRight = c < cols - 1 && grid[r][c + 1] === 0;
      if (hasLeft && hasRight) {
        candidates.push({ r, c, dir: "V", width: windowWidth });
      }
    }
  }

  return candidates;
}

/** 获取候选窗洞覆盖的所有格子索引（row * cols + col） */
function getCandidateCells(cand: WindowCandidate, cols: number): number[] {
  const cells: number[] = [];
  if (cand.dir === "H") {
    for (let dc = 0; dc < cand.width; dc++) {
      cells.push(cand.r * cols + cand.c + dc);
    }
  } else {
    for (let dr = 0; dr < cand.width; dr++) {
      cells.push((cand.r + dr) * cols + cand.c);
    }
  }
  return cells;
}

/**
 * 获取候选窗洞的"排他区域"：窗洞格子 + 沿墙方向两端各扩展 1 格（间距保障）
 * 扩展格子仅用于占位检测，不会被清零。
 */
function getExclusionCells(cand: WindowCandidate, cols: number): number[] {
  const cells = getCandidateCells(cand, cols);
  if (cand.dir === "H") {
    // 向左扩展 1 格
    const leftCell = cand.r * cols + (cand.c - 1);
    if (cand.c - 1 >= 0) cells.push(leftCell);
    // 向右扩展 1 格
    const rightCell = cand.r * cols + (cand.c + cand.width);
    cells.push(rightCell);
  } else {
    // 向上扩展 1 格
    if (cand.r - 1 >= 0) cells.push((cand.r - 1) * cols + cand.c);
    // 向下扩展 1 格
    cells.push((cand.r + cand.width) * cols + cand.c);
  }
  return cells;
}

/**
 * 从候选列表中按顺序挑选不重叠且保持间距的窗洞，最多 count 个
 * 调用前由外层决定候选列表顺序（随机或均匀）
 * 使用排他区域确保任意两个窗洞之间至少间隔 1 格
 */
function pickWindows(
  candidates: WindowCandidate[],
  count: number,
  cols: number
): WindowCandidate[] {
  const occupiedCells = new Set<number>();
  const result: WindowCandidate[] = [];

  for (const cand of candidates) {
    if (result.length >= count) break;
    const cells = getCandidateCells(cand, cols);
    if (cells.some(k => occupiedCells.has(k))) continue;
    // 将排他区域（含间距）加入占位集合
    getExclusionCells(cand, cols).forEach(k => occupiedCells.add(k));
    result.push(cand);
  }

  return result;
}

/**
 * 均匀间隔抽取：从 candidates 中均匀取 count 个索引
 * 保留候选集位置顺序，使窗户分布尽量均匀
 */
function uniformPick<T>(arr: T[], count: number): T[] {
  if (count <= 0 || arr.length === 0) return [];
  if (count >= arr.length) return [...arr];
  const step = arr.length / count;
  const result: T[] = [];
  for (let i = 0; i < count; i++) {
    result.push(arr[Math.floor(i * step + step / 2)]);
  }
  return result;
}

function processOneGrid(
  wallGrid: number[][],
  windowCount: number,
  windowWidth: number,
  randomEnable: boolean,
  seedRaw: number
): { outputGrid: number[][]; windowGrid: number[][] } {
  const rows = wallGrid.length;
  const cols = wallGrid[0].length;
  const outputGrid: number[][] = wallGrid.map(row => [...row]);
  const windowGrid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  if (windowCount === 0) return { outputGrid, windowGrid };

  const candidates = collectCandidates(wallGrid, rows, cols, windowWidth);
  if (candidates.length === 0) return { outputGrid, windowGrid };

  let ordered: WindowCandidate[];
  if (randomEnable) {
    const rand = makeLCG(seedRaw);
    const shuffled = [...candidates];
    shuffle(shuffled, rand);
    ordered = shuffled;
  } else {
    const sorted = [...candidates].sort((a, b) =>
      a.dir.localeCompare(b.dir) || a.r - b.r || a.c - b.c
    );
    ordered = uniformPick(sorted, windowCount);
  }

  const chosen = pickWindows(ordered, windowCount, cols);
  for (const win of chosen) {
    const cells = getCandidateCells(win, cols);
    for (const key of cells) {
      const r = Math.floor(key / cols);
      const c = key % cols;
      outputGrid[r][c] = 0;
      windowGrid[r][c] = 1;
    }
  }
  return { outputGrid, windowGrid };
}

export function buildingWindow(input: Record<string, unknown>): Record<string, unknown> {
  const rawList      = input.gridList ?? input.wallGrid;
  const windowCount  = typeof input.windowCount  === "number"  ? Math.max(0, Math.round(input.windowCount))  : 7;
  const windowWidth  = typeof input.windowWidth  === "number"  ? Math.max(1, Math.round(input.windowWidth))  : 1;
  const randomEnable = typeof input.randomEnable === "boolean" ? input.randomEnable : true;
  const seedRaw      = typeof input.seed         === "number"  ? input.seed : 0;

  const gridList: number[][][] = Array.isArray(rawList)
    ? (Array.isArray(rawList[0]) && Array.isArray((rawList[0] as unknown[])[0])
        ? rawList as number[][][]
        : [rawList as number[][]])
    : [];

  if (gridList.length === 0) {
    return { error: "gridList is required and must be non-empty" };
  }

  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const outputGridList: number[][][] = [];
  const windowGridList: number[][][] = [];

  gridList.forEach((grid, i) => {
    if (!grid || grid.length === 0 || !grid[0] || grid[0].length === 0) {
      outputGridList.push([]);
      windowGridList.push([]);
      return;
    }
    const effectiveSeed = baseSeed + i * 999983;
    const result = processOneGrid(grid, windowCount, windowWidth, randomEnable, effectiveSeed);
    outputGridList.push(result.outputGrid);
    windowGridList.push(result.windowGrid);
  });

  return { outputGridList, windowGridList };
}
