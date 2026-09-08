/**
 * rtsHubDevice: 在 RTS 中心枢纽区域内按同心环放置多层装置
 *
 * 输入：
 *   centerGrid (grid)  — 中心区域掩码，非零格为可用区域
 *   layers     (string) — JSON 数组，每项 {name, ring, count, shape}
 *   ringStep   (number) — 环间距（从边界向内每隔多少格一环），默认 3
 *   seed       (number) — 随机种子，0 使用时间戳
 *
 * 输出：
 *   outputGridList (array) — 每层装置独立网格
 *   nameList       (array) — [{id, name, type}] 名称清单
 */

type Grid = number[][];

interface LayerConfig {
  name: string;
  ring: number;   // 第几环（1=最外圈，数字越大越靠内）
  count: number;  // 放置数量
  shape: string;  // ring / full_ring / cross / corners
}

// --- LCG 随机数 ----------------------------------------------------------------

function makeLCG(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967295;
  };
}

// --- 网格工具 ------------------------------------------------------------------

function gridMax(grid: Grid): number {
  let m = 0;
  for (const row of grid) for (const v of row) if (v > m) m = v;
  return m;
}

/** BFS 计算每个格子到最近"空格（值=0）"的曼哈顿距离。非零格可计算"深度"。 */
function distFromBoundary(grid: Grid): number[][] {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const dist: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  const queue: [number, number][] = [];

  const dirs4: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  // 种子：所有空格（值=0）或越界邻居的非零格（边界处）
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 0) {
        dist[r][c] = 0;
        queue.push([r, c]);
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const [r, c] = queue[head++];
    for (const [dr, dc] of dirs4) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && dist[nr][nc] === -1) {
        dist[nr][nc] = dist[r][c] + 1;
        queue.push([nr, nc]);
      }
    }
  }
  return dist;
}

/** 计算所有非零格质心（行、列均值）。 */
function calcCentroid(grid: Grid): [number, number] {
  let sumR = 0, sumC = 0, cnt = 0;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[0]?.length ?? 0); c++) {
      if (grid[r][c] !== 0) { sumR += r; sumC += c; cnt++; }
    }
  }
  if (cnt === 0) return [0, 0];
  return [sumR / cnt, sumC / cnt];
}

/** Fisher-Yates 洗牌。 */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- 位置选取 ------------------------------------------------------------------

/**
 * 从候选格子中按 shape 模式选取 count 个位置：
 *   full_ring  — 取所有候选格（完整圆环）
 *   ring       — 从极角均匀间隔取 count 个（等角分布）
 *   corners    — 取距离4个角点最近的 count 个（优先角落）
 *   cross      — 取距离上下左右4个方向最近的 count 个（十字分布）
 */
function selectPositions(
  candidates: [number, number][],
  count: number,
  shape: string,
  centR: number,
  centC: number,
  rng: () => number,
): [number, number][] {
  if (candidates.length === 0) return [];

  if (shape === "full_ring") {
    return candidates;
  }

  if (shape === "ring") {
    // 极角均匀间隔采样
    const byAngle = [...candidates].sort(
      (a, b) => Math.atan2(a[0] - centR, a[1] - centC) - Math.atan2(b[0] - centR, b[1] - centC),
    );
    const take = Math.min(count, byAngle.length);
    const step = byAngle.length / take;
    return Array.from({ length: take }, (_, i) => byAngle[Math.floor(i * step)]);
  }

  if (shape === "corners") {
    // 4 个对角线方向：NW / NE / SE / SW
    const cornerDirs: [number, number][] = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
    const take = Math.min(count, cornerDirs.length);
    const result: [number, number][] = [];
    for (let i = 0; i < take; i++) {
      const [dr, dc] = cornerDirs[i];
      // 选取极角最接近该对角线方向的候选格
      let best: [number, number] | null = null;
      let bestDot = -Infinity;
      for (const [r, c] of candidates) {
        const dot = (r - centR) * dr + (c - centC) * dc;
        if (dot > bestDot) { bestDot = dot; best = [r, c]; }
      }
      if (best) result.push(best);
    }
    return result;
  }

  if (shape === "cross") {
    // 4 个正方向：N / E / S / W
    const crossDirs: [number, number][] = [[-1, 0], [0, 1], [1, 0], [0, -1]];
    const take = Math.min(count, crossDirs.length);
    const result: [number, number][] = [];
    for (let i = 0; i < take; i++) {
      const [dr, dc] = crossDirs[i];
      let best: [number, number] | null = null;
      let bestDot = -Infinity;
      for (const [r, c] of candidates) {
        const dot = (r - centR) * dr + (c - centC) * dc;
        if (dot > bestDot) { bestDot = dot; best = [r, c]; }
      }
      if (best) result.push(best);
    }
    return result;
  }

  // 默认：随机选 count 个
  return shuffle(candidates, rng).slice(0, Math.min(count, candidates.length));
}

// --- 层配置解析 ----------------------------------------------------------------

function parseLayers(raw: unknown): LayerConfig[] {
  const defaultLayers: LayerConfig[] = [
    { name: "护栏",   ring: 1, count: 16, shape: "full_ring" },
    { name: "炮台",   ring: 2, count: 8,  shape: "corners"   },
    { name: "结构柱", ring: 3, count: 4,  shape: "cross"     },
    { name: "中心核", ring: 5, count: 1,  shape: "ring"      },
  ];

  let parsed: unknown = raw;
  if (typeof raw === "string") {
    const s = (raw as string).trim();
    try { parsed = JSON.parse(s); } catch { return defaultLayers; }
  }
  if (!Array.isArray(parsed)) return defaultLayers;

  const result: LayerConfig[] = [];
  for (const item of parsed as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const name   = typeof obj.name   === "string" ? obj.name.trim() : "装置";
    const ring   = typeof obj.ring   === "number" ? Math.max(1, Math.floor(obj.ring))   : 1;
    const count  = typeof obj.count  === "number" ? Math.max(1, Math.floor(obj.count))  : 4;
    const shape  = typeof obj.shape  === "string" ? obj.shape.trim() : "ring";
    result.push({ name, ring, count, shape });
  }
  return result.length > 0 ? result : defaultLayers;
}

// --- 主导出函数 ----------------------------------------------------------------

export function rtsCenterDevice(input: Record<string, unknown>): Record<string, unknown> {
  const centerGrid = input.centerGrid as Grid | undefined;
  if (!centerGrid || centerGrid.length === 0 || !centerGrid[0] || centerGrid[0].length === 0) {
    return { error: "centerGrid is required" };
  }

  const layers   = parseLayers(input.layers);
  const ringStep = typeof input.ringStep === "number" ? Math.max(1, Math.floor(input.ringStep)) : 3;
  const seedRaw  = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const rng      = makeLCG(baseSeed);

  const rows = centerGrid.length;
  const cols = centerGrid[0].length;

  // 计算每个格子到边界（空格）的距离，深度越大越靠内
  const depthMap = distFromBoundary(centerGrid);

  // 质心用于极角排序
  const [centR, centC] = calcCentroid(centerGrid);

  // 全局最大值，用于分配 fillValue
  const baseMax = gridMax(centerGrid);

  // 为每个层分配独立 fillValue（从 baseMax+1 开始）
  const layerFillValues: number[] = layers.map((_, i) => baseMax + 1 + i);

  // 构建每层的候选格集合（深度 = ringStep * ring 附近 ±1 的格子）
  // ring=1 → 最外圈（depth = ringStep），ring=2 → depth = 2*ringStep，…
  const outputGridList: Grid[] = [];
  const nameList: Array<{ id: number; name: string; type: string }> = [];

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const fillValue = layerFillValues[li];
    const targetDepth = layer.ring * ringStep;

    // 收集该深度层的候选格（宽容 ±1 格，兼容整数步长精度）
    const candidates: [number, number][] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (centerGrid[r][c] === 0) continue;
        const d = depthMap[r][c];
        if (d >= targetDepth - 1 && d <= targetDepth + 1) {
          candidates.push([r, c]);
        }
      }
    }

    // 若该深度没有候选格（区域太小），取深度最接近的若干格
    let finalCandidates = candidates;
    if (finalCandidates.length === 0) {
      const allInner: [number, number][] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (centerGrid[r][c] !== 0) allInner.push([r, c]);
        }
      }
      finalCandidates = allInner
        .sort((a, b) => Math.abs(depthMap[a[0]][a[1]] - targetDepth) - Math.abs(depthMap[b[0]][b[1]] - targetDepth))
        .slice(0, layer.count * 4);
    }

    const selected = selectPositions(finalCandidates, layer.count, layer.shape, centR, centC, rng);

    // 生成该层独立输出网格
    const outGrid: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (const [r, c] of selected) {
      outGrid[r][c] = fillValue;
    }

    outputGridList.push(outGrid);
    nameList.push({ id: fillValue, name: layer.name, type: "asset" });
  }

  return { outputGridList, nameList };
}
