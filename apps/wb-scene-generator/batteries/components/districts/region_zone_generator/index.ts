/**
 * region_zone_generator — 区域分区生成器（DataTree 单网格形态）
 *
 * 输入单张掩码网格（grid[y][x]，非零像素为可用区域），按区域列表
 * （[[面积权重, 九宫格方位], ...] 或带名称的 [[名称, 面积, 方位], ...]）
 * 把可用区域切成不重叠的不规则分区，输出一张多值网格（每个分区一个递增 ID）。
 *
 * 端口契约与 zone_nesting / edge_green_cluster 对齐：单网格进、单网格出，
 * 网格列表由引擎按 DataTree 自动逐张 fanout。可直接喂 grid2node 转场景节点。
 *
 * 算法流程：
 *   1. 解析 inputGrid（非零像素 = 可用区域）+ regions（面积权重、九宫格方位）
 *   2. 按九宫格方位定位种子点
 *   3. 配额感知 Voronoi + Lloyd 松弛生成初始分区
 *   4. 按所选风格进行边界后处理（organic/smooth/rectilinear/voronoi）
 *   5. 输出多值网格：分区 k 的像素写入 ID (k+1)，其余为 0
 */

import { RegionDef, placeSeedPoints, lloydRelax } from './placement.js';
import { applyBoundaryStyle } from './boundary.js';

type Grid = number[][];

/** 简单的 mulberry32 伪随机数生成器 */
function makeMRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** 把 inputGrid 解析为单张二维网格；容忍意外传入的网格列表（取第一张） */
function parseGrid(raw: unknown): Grid | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0] as unknown;
  // 单网格：number[][]
  if (Array.isArray(first) && typeof (first as unknown[])[0] === 'number') {
    return raw as Grid;
  }
  // 误传网格列表：number[][][] → 取第一张（引擎正常会逐张 fanout）
  if (Array.isArray(first) && Array.isArray((first as unknown[])[0])) {
    return (raw as Grid[])[0] ?? null;
  }
  return null;
}

/**
 * 将区域列表解析为 RegionDef[]。
 * 支持：JSON 字符串 / [[area, position], ...] / [[name, area, position], ...] /
 *       [{name?, area, position}, ...]。名称在本形态中不参与计算（不再输出 nameList）。
 */
function parseRegions(raw: unknown): RegionDef[] {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).map((item) => {
    if (Array.isArray(item)) {
      // 二元组 [area, position] 或三元组 [name, area, position]
      if (item.length >= 3 || typeof item[0] === 'string') {
        const [name, area, position] = item as [unknown, unknown, unknown];
        return {
          name: typeof name === 'string' ? name : String(name ?? '区域'),
          area: typeof area === 'number' ? area : 1,
          position: typeof position === 'number' ? position : 5,
        };
      }
      const [area, position] = item as [unknown, unknown];
      return {
        name: '区域',
        area: typeof area === 'number' ? area : 1,
        position: typeof position === 'number' ? position : 5,
      };
    }
    const obj = item as Record<string, unknown>;
    return {
      name: typeof obj.name === 'string' ? obj.name : '区域',
      area: typeof obj.area === 'number' ? obj.area : 1,
      position: typeof obj.position === 'number' ? obj.position : 5,
    };
  });
}

export default function regionZoneGenerator(input: Record<string, unknown>): { outputGrid: Grid } {
  const boundaryStyle = typeof input.boundaryStyle === 'string' ? input.boundaryStyle : 'rectilinear';
  const relaxIterations = typeof input.relaxIterations === 'number' ? input.relaxIterations : 5;
  const smoothIterations = typeof input.smoothIterations === 'number' ? input.smoothIterations : 5;
  const seed = typeof input.seed === 'number' ? input.seed : 0;
  // 满铺基准：面积加和达到该值即铺满整张可用区域；不足则按 加和/基准 的比例只占据一部分
  const areaScale = typeof input.areaScale === 'number' && input.areaScale > 0 ? input.areaScale : 10;

  const grid = parseGrid(input.inputGrid);
  if (!grid) return { outputGrid: [] };

  const rows = grid.length;
  if (rows === 0 || grid[0].length === 0) return { outputGrid: [] };
  const cols = grid[0].length;

  const regions = parseRegions(input.regions);
  // 空网格骨架（全 0），尺寸与输入一致，便于下游求差/转节点
  const emptyGrid = (): Grid => Array.from({ length: rows }, () => new Array(cols).fill(0));
  if (regions.length === 0) return { outputGrid: emptyGrid() };

  const rng = makeMRng(seed === 0 ? Date.now() : seed);

  // --- Step 1: 收集可用像素（非零）---
  const usableCells: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) usableCells.push([r, c]);
    }
  }
  if (usableCells.length === 0) return { outputGrid: emptyGrid() };

  const mask = new Int32Array(rows * cols);
  for (const [r, c] of usableCells) mask[r * cols + c] = 1;

  // --- Step 2: 面积占比换算 ---
  // 以 areaScale（默认 10）为满铺基准：
  //   · 加和 < areaScale → 各区域占可用区域的 area/areaScale，合计 加和/areaScale（< 100%），其余留空
  //   · 加和 ≥ areaScale → 以加和为分母按比例瓜分，铺满整张可用区域
  const rawRatios = regions.map(r => Math.max(0, r.area));
  const ratioSum = rawRatios.reduce((s, v) => s + v, 0);
  const denom = Math.max(areaScale, ratioSum);
  const areaRatios = ratioSum <= 0
    ? rawRatios.map(() => 1 / regions.length)
    : rawRatios.map(r => r / denom);

  // --- Step 3: 种子定位 ---
  const seeds = placeSeedPoints(regions, rows, cols, usableCells, rng);

  // --- Step 4: 配额感知 Voronoi + Lloyd 松弛 ---
  const { seeds: relaxedSeeds, label } = lloydRelax(
    seeds, areaRatios, usableCells, rows, cols, Math.max(0, relaxIterations)
  );

  // --- Step 5: 边界后处理 ---
  // 部分填充时 label 中已有留空像素（-1）。边界处理只能在「已分配像素」内进行，
  // 否则 rectilinear 等风格会把整张掩码重新铺满，抹掉留空效果。
  const effectiveMask = new Int32Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) {
    effectiveMask[i] = mask[i] && label[i] >= 0 ? 1 : 0;
  }
  const processedLabel = applyBoundaryStyle(
    boundaryStyle, label, effectiveMask, rows, cols,
    relaxedSeeds.map(s => ({ x: s.x, y: s.y })),
    areaRatios, Math.max(1, smoothIterations)
  );

  // --- Step 6: 输出单张多值网格：分区 k → ID (k+1) ---
  const outputGrid: Grid = [];
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const k = processedLabel[idx];
      row.push(mask[idx] && k >= 0 ? k + 1 : 0);
    }
    outputGrid.push(row);
  }

  return { outputGrid };
}
