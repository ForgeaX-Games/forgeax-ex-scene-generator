/**
 * cliff_platform_gen: 显式圆形平台放置 + 独立噪声塑形 → 有机多块梯田悬崖
 *
 * 算法核心：
 *   1. 每层由 N 个独立圆形平台构成（圆形 + 柏林噪声轮廓扰动）
 *   2. 每个平台有独立噪声偏移量 → 形状各不相同
 *   3. 平台中心可随机或贴边放置（edgeBias）→ 产生贴边悬崖弧形效果
 *   4. 按层从低到高叠加：高层覆盖低层，自然形成嵌套关系
 *
 * 与高度场方案的根本区别：
 *   高度场切割 → 连续区域，同层几乎总是1块大连通体
 *   显式放置   → 每层精确 N 块，形状各异，位置明确可控
 */

// ─── LCG 随机数 ──────────────────────────────────────────────────────────────

function makeLCG(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// ─── 柏林噪声 ────────────────────────────────────────────────────────────────

function buildPermTable(rng: () => number): Uint8Array {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  return p;
}

function grad2(hash: number, x: number, y: number): number {
  const h = hash & 7;
  const u = h < 4 ? x : y;
  const v = h < 4 ? y : x;
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function perlin2D(perm: Uint8Array, x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const aa = perm[(perm[xi] + yi) & 255];
  const ab = perm[(perm[xi] + yi + 1) & 255];
  const ba = perm[(perm[xi + 1] + yi) & 255];
  const bb = perm[(perm[xi + 1] + yi + 1) & 255];
  const u = fade(xf);
  const v = fade(yf);
  return lp(lp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u),
             lp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u), v);
}

/** fBm 噪声，归一化到 [0, 1] */
function fbm(perm: Uint8Array, x: number, y: number, octaves: number): number {
  let val = 0, amp = 0.5, freq = 1, maxV = 0;
  for (let o = 0; o < octaves; o++) {
    val += perlin2D(perm, x * freq, y * freq) * amp;
    maxV += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return (val / maxV) * 0.5 + 0.5;
}

// ─── 边界框 ──────────────────────────────────────────────────────────────────

interface BBox { r0: number; r1: number; c0: number; c1: number; }

function getBoundingBox(grid: number[][]): BBox | null {
  const rows = grid.length, cols = grid[0].length;
  let r0 = rows, r1 = -1, c0 = cols, c1 = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) {
        if (r < r0) r0 = r; if (r > r1) r1 = r;
        if (c < c0) c0 = c; if (c > c1) c1 = c;
      }
    }
  }
  return r1 < 0 ? null : { r0, r1, c0, c1 };
}

// ─── 平台定义 ────────────────────────────────────────────────────────────────

interface Patch {
  cr: number;       // 中心行
  cc: number;       // 中心列
  radius: number;   // 基础半径
  noiseOffR: number; // 噪声行偏移（保证每块形状不同）
  noiseOffC: number; // 噪声列偏移
}

// ─── 平台中心放置 ─────────────────────────────────────────────────────────────

/**
 * 使用泊松盘采样思想：在 bbox 内随机放置 n 个中心点，
 * 保证两两之间最小距离 >= minDist，并按 edgeBias 概率放置在边缘。
 */
function placePatchCenters(
  n: number,
  avgRadius: number,
  bbox: BBox,
  edgeBias: number,
  rng: () => number
): Array<{ cr: number; cc: number }> {
  const bboxH = bbox.r1 - bbox.r0 + 1;
  const bboxW = bbox.c1 - bbox.c0 + 1;
  const minDist = avgRadius * 0.7;
  const centers: Array<{ cr: number; cc: number }> = [];
  const maxAttempts = n * 300;
  let attempts = 0;

  while (centers.length < n && attempts < maxAttempts) {
    attempts++;
    let cr: number, cc: number;

    if (rng() < edgeBias) {
      // 贴边放置：中心在地图边缘附近，产生半圆弧形悬崖
      const edge = Math.floor(rng() * 4);
      const inset = avgRadius * (0.05 + 0.5 * rng()); // 贴近边缘的程度
      const pos = rng();
      switch (edge) {
        case 0: cr = bbox.r0 + inset;       cc = bbox.c0 + pos * bboxW; break; // 上边
        case 1: cr = bbox.r1 - inset;       cc = bbox.c0 + pos * bboxW; break; // 下边
        case 2: cr = bbox.r0 + pos * bboxH; cc = bbox.c0 + inset;       break; // 左边
        default:cr = bbox.r0 + pos * bboxH; cc = bbox.c1 - inset;       break; // 右边
      }
    } else {
      // 内部随机放置
      cr = bbox.r0 + rng() * bboxH;
      cc = bbox.c0 + rng() * bboxW;
    }

    // 最小距离检验
    let tooClose = false;
    for (const e of centers) {
      const dr = cr - e.cr, dc = cc - e.cc;
      if (Math.sqrt(dr * dr + dc * dc) < minDist) { tooClose = true; break; }
    }
    if (!tooClose) centers.push({ cr, cc });
  }

  // 若泊松盘采样不足，用纯随机兜底
  while (centers.length < n) {
    centers.push({
      cr: bbox.r0 + rng() * bboxH,
      cc: bbox.c0 + rng() * bboxW,
    });
  }

  return centers;
}

// ─── 判断格子是否在平台内 ──────────────────────────────────────────────────────

/**
 * 使用带噪声扰动的距离判断：
 *   effectiveRadius = radius × (1 + noiseAmp × (noise - 0.5) × 2)
 *   inside = dist(cell, center) < effectiveRadius
 *
 * 每个平台有独立噪声偏移 → 每块形状各不相同
 */
function cellInPatch(
  r: number, c: number,
  patch: Patch,
  perm: Uint8Array,
  noiseFreq: number,  // 归一化后的噪声频率
  noiseAmp: number    // = 1 - patchRoundness
): boolean {
  const dr = r - patch.cr;
  const dc = c - patch.cc;
  const dist = Math.sqrt(dr * dr + dc * dc);

  // 快速拒绝：超出最大可能半径
  if (dist > patch.radius * (1 + noiseAmp + 0.05)) return false;

  // 每个平台使用独立噪声偏移，确保形状唯一性
  const nx = (r + patch.noiseOffR) * noiseFreq;
  const ny = (c + patch.noiseOffC) * noiseFreq;
  const noise = fbm(perm, nx, ny, 4);

  const effectiveRadius = patch.radius * (1 + noiseAmp * (noise - 0.5) * 2);
  return dist < effectiveRadius;
}

// ─── 默认参数计算 ────────────────────────────────────────────────────────────

function defaultAreaRatios(tierCount: number): number[] {
  // 上层小面积，下层大面积，几何递增
  const ratios: number[] = [];
  let rem = 0.85; // 留 15% 给底层
  const total = (tierCount - 1) * tierCount / 2;
  for (let i = 0; i < tierCount - 1; i++) {
    ratios.push(rem * (i + 1) / total);
  }
  return ratios;
}

function defaultPatchCounts(tierCount: number): number[] {
  // 越高的层平台数量越少
  return Array.from({ length: tierCount - 1 }, (_, i) =>
    Math.max(1, Math.round(2 + i * 1.5))
  );
}

// ─── 主导出函数 ──────────────────────────────────────────────────────────────

export function cliffPlatformGen(input: Record<string, unknown>): Record<string, unknown> {
  const grid = input.inputGrid as number[][] | undefined;
  if (!grid || grid.length === 0 || !grid[0] || grid[0].length === 0) {
    return { error: "inputGrid is required" };
  }

  const rows = grid.length;
  const cols = grid[0].length;

  const tierCount = typeof input.tierCount === "number"
    ? Math.max(2, Math.min(6, Math.round(input.tierCount))) : 4;

  const patchEdgeDetail = typeof input.patchEdgeDetail === "number"
    ? Math.max(0.5, input.patchEdgeDetail) : 2.5;

  const patchRoundness = typeof input.patchRoundness === "number"
    ? Math.max(0, Math.min(0.99, input.patchRoundness)) : 0.65;
  const noiseAmp = 1 - patchRoundness; // 噪声振幅 = 1 - 圆度

  const edgeBias = typeof input.edgeBias === "number"
    ? Math.max(0, Math.min(1, input.edgeBias)) : 0.3;

  const patchSizeVar = typeof input.patchSizeVariation === "number"
    ? Math.max(0, Math.min(1, input.patchSizeVariation)) : 0.45;

  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;

  // ── 解析面积占比 ──────────────────────────────────────────
  let areaRatios = defaultAreaRatios(tierCount);
  if (typeof input.tierAreaRatios === "string" && input.tierAreaRatios.trim()) {
    try {
      const parsed = JSON.parse(input.tierAreaRatios.trim()) as unknown;
      if (Array.isArray(parsed) && parsed.length === tierCount - 1) {
        const nums = (parsed as unknown[]).map((v: unknown) =>
          typeof v === "number" && v > 0 ? v : 0.05
        );
        if (nums.reduce((s, v) => s + v, 0) < 1) areaRatios = nums;
      }
    } catch { /* 解析失败使用默认 */ }
  }

  // ── 解析各层平台数量 ───────────────────────────────────────
  let patchCounts = defaultPatchCounts(tierCount);
  if (typeof input.tierPatchCounts === "string" && input.tierPatchCounts.trim()) {
    try {
      const parsed = JSON.parse(input.tierPatchCounts.trim()) as unknown;
      if (Array.isArray(parsed) && parsed.length === tierCount - 1) {
        patchCounts = (parsed as unknown[]).map((v: unknown) =>
          typeof v === "number" ? Math.max(1, Math.round(v)) : 2
        );
      }
    } catch { /* 解析失败使用默认 */ }
  }

  const bbox = getBoundingBox(grid);
  if (!bbox) return { error: "grid contains no non-zero cells" };

  const bboxH = bbox.r1 - bbox.r0 + 1;
  const bboxW = bbox.c1 - bbox.c0 + 1;
  const totalCells = bboxH * bboxW;

  // 噪声频率归一化：使用 bbox 尺寸归一化，确保 noiseFreq 与网格尺寸无关
  const bboxScale = Math.min(bboxH, bboxW);
  const noiseFreq = patchEdgeDetail / bboxScale;

  const rng = makeLCG(seed);
  const perm = buildPermTable(rng);

  // ── 初始化：所有有效格子 = 底层（tierCount）────────────────
  const outputGrid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let r = bbox.r0; r <= bbox.r1; r++) {
    for (let c = bbox.c0; c <= bbox.c1; c++) {
      if (grid[r][c] !== 0) outputGrid[r][c] = tierCount;
    }
  }

  // ── 按层从低到高放置平台（高层覆盖低层）──────────────────────
  // tier 1 = 最高，tier tierCount-1 = 倒数第二层
  // 处理顺序：tier tierCount-1 → tier 1（高层最后放，确保显示在最上方）
  for (let tier = tierCount - 1; tier >= 1; tier--) {
    const idx = tier - 1; // 对应 areaRatios/patchCounts 的下标
    const targetArea = areaRatios[idx] * totalCells;
    const n = patchCounts[idx];

    // 平均半径：基于目标面积和平台数量推算
    // × 1.15 补偿噪声扰动导致的面积收缩
    const avgRadius = Math.sqrt(targetArea / n / Math.PI) * 1.15;

    // 放置平台中心
    const centers = placePatchCenters(n, avgRadius, bbox, edgeBias, rng);

    // 生成平台定义（含独立噪声偏移）
    const patches: Patch[] = centers.map(({ cr, cc }) => {
      // 大小随机变化
      const variation = 1 - patchSizeVar / 2 + patchSizeVar * rng();
      return {
        cr,
        cc,
        radius: avgRadius * variation,
        noiseOffR: rng() * 800, // 独立噪声偏移，保证每块形状不同
        noiseOffC: rng() * 800,
      };
    });

    // 为每个有效格子检测是否在任意平台内
    for (let r = bbox.r0; r <= bbox.r1; r++) {
      for (let c = bbox.c0; c <= bbox.c1; c++) {
        if (grid[r][c] === 0) continue;
        for (const patch of patches) {
          if (cellInPatch(r, c, patch, perm, noiseFreq, noiseAmp)) {
            outputGrid[r][c] = tier;
            break; // 找到即标记，不需要继续检测其他平台
          }
        }
      }
    }
  }

  // ── 边界平滑：多数投票滤波（Majority Vote Filter）─────────────────────────
  // 参考 river_spline 的移动平均思路，针对二维区域图的等效算法是：
  // 对每个格子统计邻域内各层值出现次数，赋值为出现最多的层值，迭代消除锯齿。
  const smoothPasses = typeof input.smoothPasses === "number"
    ? Math.max(0, Math.min(8, Math.round(input.smoothPasses))) : 2;
  const smoothRadius = typeof input.smoothRadius === "number"
    ? Math.max(1, Math.min(6, Math.round(input.smoothRadius))) : 2;

  let finalGrid = outputGrid;
  for (let pass = 0; pass < smoothPasses; pass++) {
    const next: number[][] = finalGrid.map(row => [...row]);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (finalGrid[r][c] === 0) continue; // 范围外不处理

        // 统计邻域内各层值票数
        const votes: Record<number, number> = {};
        for (let dr = -smoothRadius; dr <= smoothRadius; dr++) {
          for (let dc = -smoothRadius; dc <= smoothRadius; dc++) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            const v = finalGrid[nr][nc];
            if (v === 0) continue; // 忽略范围外格子的票
            votes[v] = (votes[v] ?? 0) + 1;
          }
        }

        // 找最高票数的层值（票数相同时保留当前值，避免漂移）
        let bestVal = finalGrid[r][c];
        let bestCount = votes[bestVal] ?? 0;
        for (const [valStr, count] of Object.entries(votes)) {
          if (count > bestCount) {
            bestCount = count;
            bestVal = Number(valStr);
          }
        }
        next[r][c] = bestVal;
      }
    }
    finalGrid = next;
  }

  // ── 生成名称清单 ───────────────────────────────────────────
  const namePool = ["最高地", "高地", "中高地", "中地", "中低地", "低地", "底层", "谷底"];
  const outputNameList = Array.from({ length: tierCount }, (_, i) => ({
    id: i + 1,
    name: i < namePool.length ? namePool[i] : `层${i + 1}`,
    type: "tile",
  }));

  return { outputGrid: finalGrid, outputNameList };
}
