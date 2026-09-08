/**
 * decoration_border: 在单张基准网格周围按规则摆放 1×1 装饰物
 *
 * DataTree 数据格式：输入 inputGrid 与输出 outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 *
 * 输入：
 *   inputGrid (grid)      — 单张基准网格，非零区域作为参考边界
 *   decorationName        — 装饰物规格，支持三种格式：
 *       1. 字符串单名称：  "树木"
 *       2. 字符串多名称：  "树木，小草，花朵"（逗号/顿号/分号/换行/竖线均可）
 *          → 各种类按 count 总量均匀轮转分配
 *       3. 对象数组（带各自数量）：[{"树木": 3}, {"小草": 5}, {"花朵": 2}]
 *          → 每种按自身 count 独立放置，count 参数失效
 *   count (number)        — 总装饰物数量（格式 1/2 时生效）
 *   rotate (bool)
 *   fillMode (string)     — random / equidistant / spaced_random / sequential
 *   offset (number); seed (number)
 *   startCount (number, sequential 专用); itemSpacing (number, sequential 专用)
 *
 * 输出：
 *   outputGrid (grid)     — 仅含装饰物的单张多值网格（每种装饰物一个递增 fillValue，从 max+1 起）
 *   nameList (array)      — 装饰物名称清单 [{id, name, type}]（每种对应独立 id）
 */

type Grid = number[][];

/** 将网格顺时针旋转 90°，返回新网格。 */
function rotateGrid90(grid: Grid): Grid {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return grid;
  const rotated: Grid = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rotated[c][rows - 1 - r] = grid[r][c];
    }
  }
  return rotated;
}

/** 将网格顺时针旋转 n × 90°（自动对 4 取模，复用 rotateGrid90）。 */
function rotateGridN(grid: Grid, n: number): Grid {
  let result = grid;
  for (let i = 0; i < n % 4; i++) result = rotateGrid90(result);
  return result;
}

/**
 * 用切比雪夫（8方向）BFS 计算网格中每个格子到最近种子格的距离；
 * useVirtualExterior 为 true 时把网格边界外视为虚拟种子（距离 0），使边界格距离恒为 1，
 * 仅在内部方向（distFromEmpty）时启用，外部方向启用会导致边界空格被误标为距离 1。
 */
function chebyshevDistFrom(grid: Grid, seedCond: (v: number) => boolean, useVirtualExterior = false): number[][] {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const dist: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  const queue: [number, number][] = [];

  const dirs8: [number, number][] = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1],
  ];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (seedCond(grid[r][c])) {
        dist[r][c] = 0;
        queue.push([r, c]);
      } else if (useVirtualExterior) {
        // 若某个 8 邻格越界，则将外部视为距离 0 的虚拟种子，
        // 使该格子距离为 1。仅用于 distFromEmpty（内部）情形，
        // 让网格边界本身充当外墙。
        for (const [dr, dc] of dirs8) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) {
            if (dist[r][c] === -1) {
              dist[r][c] = 1;
              queue.push([r, c]);
            }
            break;
          }
        }
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const [r, c] = queue[head++];
    for (const [dr, dc] of dirs8) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && dist[nr][nc] === -1) {
        dist[nr][nc] = dist[r][c] + 1;
        queue.push([nr, nc]);
      }
    }
  }
  return dist;
}

/**
 * 返回距离填充边界恰好等于 anchorDist 的候选放置坐标列表；
 * anchorDist ≥ 1 时在外侧空格选取，anchorDist ≤ 0 时在内侧非零格选取。
 */
function findBorderPositions(baseGrid: Grid, anchorDist: number): [number, number][] {
  const rows = baseGrid.length;
  const cols = baseGrid[0]?.length ?? 0;
  const positions: [number, number][] = [];

  if (anchorDist >= 1) {
    // 外部模式：找到切比雪夫距离填充区域恰好等于 anchorDist 的空格。
    // 不启用虚拟外部，避免远离填充区的边界空格被误判为相邻。
    const distFromFilled = chebyshevDistFrom(baseGrid, v => v !== 0, false);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (baseGrid[r][c] === 0 && distFromFilled[r][c] === anchorDist) {
          positions.push([r, c]);
        }
      }
    }
  } else {
    // 内部模式：找到切比雪夫距离空格/边界等于 (1 - anchorDist) 的非零格。
    // 启用虚拟外部，使网格边界本身作为距离 0 的"外部"，
    // offset=0 → 最外圈非零格；offset=-1 → 向内第 1 圈；offset=-5 → 向内第 5 圈。
    const targetDistFromEmpty = 1 - anchorDist;
    const distFromEmpty = chebyshevDistFrom(baseGrid, v => v === 0, true);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (baseGrid[r][c] !== 0 && distFromEmpty[r][c] === targetDistFromEmpty) {
          positions.push([r, c]);
        }
      }
    }
  }
  return positions;
}

/** 以给定种子创建线性同余随机数生成器（LCG），每次调用返回 [0, 1) 的浮点数。 */
function makeLCG(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967295;
  };
}

/** 裁剪 stamp 网格，去掉四周多余的零行列，返回仅包含非零内容的最小包围盒。 */
function extractStampContent(stamp: Grid): Grid {
  const sRows = stamp.length;
  const sCols = stamp[0]?.length ?? 0;
  let minR = sRows, maxR = -1, minC = sCols, maxC = -1;

  for (let r = 0; r < sRows; r++) {
    for (let c = 0; c < sCols; c++) {
      if (stamp[r][c] !== 0) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  if (maxR === -1) return [[0]];
  return stamp.slice(minR, maxR + 1).map(row => row.slice(minC, maxC + 1));
}

/** 以 (anchorR, anchorC) 为中心将 stamp 的非零值写入 outputGrid，越界部分自动忽略。 */
function placeStamp(outputGrid: Grid, stamp: Grid, anchorR: number, anchorC: number): void {
  const rows = outputGrid.length;
  const cols = outputGrid[0]?.length ?? 0;
  const sRows = stamp.length;
  const sCols = stamp[0]?.length ?? 0;
  const halfR = Math.floor(sRows / 2);
  const halfC = Math.floor(sCols / 2);

  for (let sr = 0; sr < sRows; sr++) {
    for (let sc = 0; sc < sCols; sc++) {
      const val = stamp[sr][sc];
      if (val !== 0) {
        const gr = anchorR + sr - halfR;
        const gc = anchorC + sc - halfC;
        if (gr >= 0 && gr < rows && gc >= 0 && gc < cols) {
          outputGrid[gr][gc] = val;
        }
      }
    }
  }
}

// ── 位置选取辅助函数 ───────────────────────────────────────────────────────────

/** 计算两个格子坐标之间的切比雪夫距离（max(|Δr|, |Δc|)）。 */
function chebyshevDist(a: [number, number], b: [number, number]): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

/** 将坐标列表按围绕质心的极角从小到大排序，形成环形遍历顺序。 */
function sortByAngle(positions: [number, number][]): [number, number][] {
  let sumR = 0;
  let sumC = 0;
  for (const [r, c] of positions) { sumR += r; sumC += c; }
  const centR = sumR / positions.length;
  const centC = sumC / positions.length;
  return [...positions].sort(
    (a, b) => Math.atan2(a[0] - centR, a[1] - centC) - Math.atan2(b[0] - centR, b[1] - centC),
  );
}

/** 随机模式：Fisher-Yates 全局洗牌后取前 count 个位置。 */
function selectRandom(
  positions: [number, number][],
  count: number,
  rng: () => number,
): [number, number][] {
  const shuffled = [...positions];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/** 均匀分布模式：按质心等角步长在环形上选取 count 个等间距位置。 */
function selectEquidistant(
  positions: [number, number][],
  count: number,
): [number, number][] {
  if (positions.length === 0) return [];
  const ring = sortByAngle(positions);
  const take = Math.min(count, ring.length);
  const step = ring.length / take;
  const result: [number, number][] = [];
  for (let i = 0; i < take; i++) {
    result.push(ring[Math.floor(i * step)]);
  }
  return result;
}

/**
 * 间距随机模式：随机洗牌后逐一选取，保证任意两个锚点的切比雪夫距离 ≥ (2H + 2)，
 * 即相邻图章边缘之间至少留 1 格空隙。
 */
function selectSpacedRandom(
  positions: [number, number][],
  count: number,
  halfStamp: number,
  rng: () => number,
): [number, number][] {
  // 间距约束：anchorDist ≥ 2*halfStamp + 2
  const minDist = 2 * halfStamp + 2;

  const shuffled = [...positions];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const selected: [number, number][] = [];
  for (const pos of shuffled) {
    if (selected.length >= count) break;
    if (!selected.some(p => chebyshevDist(pos, p) < minDist)) {
      selected.push(pos);
    }
  }
  return selected;
}

/**
 * 顺序模式：从 startCount 个随机起点沿环形顺序向前扫描，
 * 相邻锚点距离 ≥ (2H + 1 + itemSpacing) 时才放置，各起点均匀分配总配额。
 */
function selectSequential(
  positions: [number, number][],
  count: number,
  halfStamp: number,
  startCount: number,
  itemSpacing: number,
  rng: () => number,
): [number, number][] {
  if (positions.length === 0) return [];

  const ring = sortByAngle(positions);
  const n = ring.length;
  // 图章宽度 (2H+1) + itemSpacing 间隔
  const minStep = 2 * halfStamp + 1 + Math.max(0, itemSpacing);

  // 打乱索引以随机选取起点
  const idxPool = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idxPool[i], idxPool[j]] = [idxPool[j], idxPool[i]];
  }
  const starts = idxPool.slice(0, Math.min(Math.max(1, startCount), n));

  // 均匀分配配额：每个起点最多放置 ceil(count / startCount) 个图章，
  // 避免第一个起点独占所有名额。
  const countPerStart = Math.ceil(count / starts.length);

  const selected: [number, number][] = [];
  const usedIdx = new Set<number>();

  for (const startIdx of starts) {
    if (selected.length >= count) break;
    if (usedIdx.has(startIdx)) continue;

    // 在起点位置放置第一个图章
    usedIdx.add(startIdx);
    selected.push(ring[startIdx]);
    let curIdx = startIdx;
    let placedFromStart = 1;

    // 向前扫描，直到当前起点配额耗尽
    let scanned = 0;
    while (selected.length < count && placedFromStart < countPerStart && scanned < n) {
      scanned++;
      const candIdx = (curIdx + scanned) % n;
      if (!usedIdx.has(candIdx) && chebyshevDist(ring[candIdx], ring[curIdx]) >= minStep) {
        usedIdx.add(candIdx);
        selected.push(ring[candIdx]);
        curIdx = candIdx;
        scanned = 0;
        placedFromStart++;
      }
    }
  }

  return selected;
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

/** 返回网格中所有格子的最大值。 */
function maxGrid(grid: Grid): number {
  let m = 0;
  for (const row of grid) for (const v of row) if (v > m) m = v;
  return m;
}

/** 单种装饰物规格：名称 + 该种类的放置数量（0 表示由外部 count 控制）。 */
interface DecorationSpec {
  name: string;
  count: number; // 0 = 不指定，由外部 count 统一控制
}

/**
 * 解析 decorationName 输入，返回 DecorationSpec 数组。支持三种格式：
 *
 * 格式一：字符串单/多名称
 *   "树木"  →  [{name:"树木", count:0}]
 *   "树木，小草，花朵"  →  [{name:"树木",count:0}, ...]
 *   分隔符：中英文逗号/顿号/中英文分号/换行/竖线，自动去重去空
 *
 * 格式二：对象数组（每项为 {名称: 数量} 的单键对象）
 *   [{"树木": 3}, {"小草": 5}]  →  [{name:"树木",count:3}, {name:"小草",count:5}]
 *   数量 ≤ 0 时视为 0（由外部 count 控制）
 *
 * 解析失败或结果为空时，返回默认 [{name:"装饰物", count:0}]。
 */
function parseDecorationSpecs(raw: unknown): DecorationSpec[] {
  // ── 字符串先尝试 JSON 解析，成功则转为数组再走格式二 ──────────────────────
  if (typeof raw === "string") {
    const s = raw.trim();
    if (s.startsWith("[") || s.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(s);
        if (Array.isArray(parsed)) raw = parsed;
      } catch { /* 解析失败则继续走字符串路径 */ }
    }
  }

  // ── 格式二：数组输入 ──────────────────────────────────────────────────────
  if (Array.isArray(raw)) {
    const specs: DecorationSpec[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const keys = Object.keys(item as Record<string, unknown>);
        for (const key of keys) {
          const name = key.trim();
          if (!name || seen.has(name)) continue;
          seen.add(name);
          const val = (item as Record<string, unknown>)[key];
          const cnt = typeof val === "number" && val > 0 ? Math.floor(val) : 0;
          specs.push({ name, count: cnt });
        }
      }
    }
    return specs;
  }

  // ── 格式一：字符串输入 ────────────────────────────────────────────────────
  const str = typeof raw === "string" ? raw : "";
  const names = str
    .split(/[，,、；;\n\r|]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const seen = new Set<string>();
  const specs: DecorationSpec[] = [];
  for (const n of names) {
    if (!seen.has(n)) { seen.add(n); specs.push({ name: n, count: 0 }); }
  }

  return specs;
}

// ── 单网格处理 ────────────────────────────────────────────────────────────────

/**
 * 处理单个网格：定位边界候选位置 → 按 fillMode 选取 → 按配额分配各种装饰物 → 盖印。
 *
 * slots：每种装饰物的 {fillValue, count} 列表。
 *   - count > 0：该种类独立占用指定数量的候选位置
 *   - count = 0：该种类参与均匀轮转（与其他 count=0 的种类共享 globalCount 个位置）
 * globalCount：所有 count=0 种类共享的总放置数量（对应外部 count 参数）。
 */
function processOneGrid(
  baseGrid: Grid,
  slots: { fillValue: number; count: number }[],
  globalCount: number,
  rotate: boolean,
  fillMode: string,
  offset: number,
  startCount: number,
  itemSpacing: number,
  effectiveSeed: number,
): Grid {
  const rng = makeLCG(effectiveSeed);
  const rows = baseGrid.length;
  const cols = baseGrid[0].length;
  const outputGrid: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  // 固定 1×1 stamp，halfStamp = 0
  const halfStamp = 0;
  const anchorDist = offset + halfStamp;
  const borderPositions = findBorderPositions(baseGrid, anchorDist);

  // 计算总需求：count>0 的种类各自独立，count=0 的种类共用 globalCount
  const fixedSlots  = slots.filter(s => s.count > 0);
  const floatSlots  = slots.filter(s => s.count === 0);
  const totalNeeded = fixedSlots.reduce((s, x) => s + x.count, 0)
                    + (floatSlots.length > 0 ? globalCount : 0);

  // 一次性选出所有需要的候选位置
  let allPositions: [number, number][];
  if (fillMode === "equidistant") {
    allPositions = selectEquidistant(borderPositions, totalNeeded);
  } else if (fillMode === "spaced_random") {
    allPositions = selectSpacedRandom(borderPositions, totalNeeded, halfStamp, rng);
  } else if (fillMode === "sequential") {
    allPositions = selectSequential(borderPositions, totalNeeded, halfStamp, startCount, itemSpacing, rng);
  } else {
    allPositions = selectRandom(borderPositions, totalNeeded, rng);
  }

  // 随机打乱位置顺序，避免固定种类总占前段
  for (let i = allPositions.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [allPositions[i], allPositions[j]] = [allPositions[j], allPositions[i]];
  }

  // 按配额分配：先为 count>0 的种类划出专属位置，剩余给 count=0 的种类轮转
  let posIdx = 0;

  // 固定配额种类：各取 count 个位置
  for (const slot of fixedSlots) {
    const take = Math.min(slot.count, allPositions.length - posIdx);
    for (let k = 0; k < take; k++) {
      const [r, c] = allPositions[posIdx++];
      void rotate;
      placeStamp(outputGrid, [[slot.fillValue]], r, c);
    }
  }

  // 浮动配额种类：在剩余位置中均匀轮转
  if (floatSlots.length > 0) {
    // 打乱浮动种类顺序，使轮转起点随机
    const shuffledFloat = [...floatSlots];
    for (let i = shuffledFloat.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffledFloat[i], shuffledFloat[j]] = [shuffledFloat[j], shuffledFloat[i]];
    }
    let floatIdx = 0;
    const remaining = Math.min(globalCount, allPositions.length - posIdx);
    for (let k = 0; k < remaining; k++) {
      const [r, c] = allPositions[posIdx++];
      void rotate;
      const val = shuffledFloat[floatIdx % shuffledFloat.length].fillValue;
      floatIdx++;
      placeStamp(outputGrid, [[val]], r, c);
    }
  }

  return outputGrid;
}

// ── 主导出函数 ────────────────────────────────────────────────────────────────

/** 解析单张二维网格（number[][]）；非法返回 null。
 * DataTree 模型下引擎按 access:item 对网格列表自动 fanout，本算子每次只收到一张网格。 */
function parseGrid(raw: unknown): Grid | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0];
  // 单张网格：raw[0] 是数字数组（或空行）
  if (Array.isArray(first) && (first.length === 0 || typeof first[0] === "number")) {
    return raw as Grid;
  }
  return null;
}

/** 主入口（DataTree item 形态）：解析单张基准网格、放置边界装饰物，
 * 输出单张多值装饰物网格（每种装饰物一个递增 fillValue）与名称清单。 */
export function decorationBorder(input: Record<string, unknown>): Record<string, unknown> {
  const baseGrid = parseGrid(input.inputGrid);
  if (!baseGrid) return { error: "inputGrid is required" };
  if (baseGrid.length === 0 || !baseGrid[0] || baseGrid[0].length === 0) {
    return { error: "inputGrid is empty" };
  }

  // 解析装饰物规格（支持字符串单/多名称 或 [{名称:数量}] 对象数组）
  const specs = parseDecorationSpecs(input.decorationName);
  const count = typeof input.count === "number" ? Math.max(0, Math.floor(input.count)) : 20;
  const rotate = typeof input.rotate === "boolean" ? input.rotate : false;
  const fillMode = typeof input.fillMode === "string" ? input.fillMode : "random";
  const offset = typeof input.offset === "number" ? Math.floor(input.offset) : 1;
  const seed = typeof input.seed === "number" ? Math.floor(input.seed) : 0;
  const startCount = typeof input.startCount === "number" ? Math.max(1, Math.floor(input.startCount)) : 4;
  const itemSpacing = typeof input.itemSpacing === "number" ? Math.floor(input.itemSpacing) : 8;

  if (specs.length === 0) {
    const empty: Grid = Array.from({ length: baseGrid.length }, () => new Array(baseGrid[0].length).fill(0));
    return { outputGrid: empty, nameList: [] };
  }

  const baseSeed = seed === 0 ? Date.now() : seed;

  // 为每种规格分配独立的连续 fillValue（从本网格最大值 + 1 开始）
  const globalMax = maxGrid(baseGrid);
  const slots = specs.map((spec, i) => ({
    fillValue: globalMax + 1 + i,
    count: spec.count,
    name: spec.name,
  }));

  // 单张多值网格：每种装饰物各占一个 fillValue（下游可按值拆分 / 命名）
  const outputGrid = processOneGrid(
    baseGrid, slots, count, rotate, fillMode, offset, startCount, itemSpacing, baseSeed,
  );

  const usedValues = new Set<number>();
  for (const row of outputGrid) for (const v of row) if (v !== 0) usedValues.add(v);

  // 只输出在输出网格中实际出现的名称条目，补充 type: "asset"
  const nameList = slots
    .filter(s => usedValues.has(s.fillValue))
    .map(s => ({ id: s.fillValue, name: s.name, type: "asset" }));

  return { outputGrid, nameList };
}
