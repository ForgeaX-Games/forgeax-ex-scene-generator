/**
 * alg_region_area_partition — 配额感知区域划分（Partition 形态）
 *
 * 在父区域掩码内，根据中心点列表 + 面积权重列表，把可用区域切成若干
 * 互不重叠的子区域。输出 partition[]（每张 0/1 网格），与 flood_grow /
 * region_components 的 partition 契约一致。
 *
 * 算法搬自 components/districts/region_zone_generator：
 *   配额感知 Voronoi + Lloyd 松弛 + 边界后处理。
 */

// Battery loader imports index.ts via Node type-stripping; sibling modules are
// also .ts on disk, so use .ts specifiers (phantom .js files are not emitted).
import { applyBoundaryStyle } from './boundary.ts';
import { placeSeedPoints, lloydRelax, buildWarpField, type SeedPoint, type SeedShape } from './placement.ts';

type Grid = number[][];

function makeMRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function emptyGrid(rows: number, cols: number): Grid {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
}

function parseJson(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

/** 从点掩码 grid 中按行优先收集非零格作为中心点。 */
function extractCentersFromGrid(points: Grid): Array<[number, number]> {
  const centers: Array<[number, number]> = [];
  for (let r = 0; r < points.length; r++) {
    const row = points[r];
    if (!Array.isArray(row)) continue;
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== 0) centers.push([r, c]);
    }
  }
  return centers;
}

/** point2d 列表 → 种子点（x→列，y→行）。 */
function parsePoint2dSeeds(raw: unknown, rows: number, cols: number): SeedPoint[] {
  const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const seeds: SeedPoint[] = [];
  for (const p of arr) {
    if (!p || typeof p !== 'object') continue;
    const px = (p as { x?: unknown }).x;
    const py = (p as { y?: unknown }).y;
    if (typeof px !== 'number' || typeof py !== 'number') continue;
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const c = Math.round(px);
    const r = Math.round(py);
    if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
    seeds.push({ x: c, y: r, regionIdx: seeds.length });
  }
  return seeds;
}

/**
 * 解析中心点列表。优先：
 *   - points point2d 列表（x→列、y→行）
 *   兼容：centers 数组、points 网格掩码、positions 九宫格方位
 */
function parseCenterSeeds(
  input: Record<string, unknown>,
  areas: number[],
  rows: number,
  cols: number,
  usableCells: Array<[number, number]>,
  rng: () => number,
): SeedPoint[] {
  if (input.points != null) {
    const fromPoint2d = parsePoint2dSeeds(input.points, rows, cols);
    if (fromPoint2d.length > 0) return fromPoint2d;
  }

  const pointsRaw = input.centers;
  const parsed = parseJson(pointsRaw);

  if (Array.isArray(parsed) && parsed.length > 0) {
    const first = parsed[0];
    if (Array.isArray(first) && first.length >= 2) {
      return (parsed as unknown[]).map((item, i) => {
        const [a, b] = item as [unknown, unknown];
        const fa = typeof a === 'number' ? a : 0;
        const fb = typeof b === 'number' ? b : 0;
        // 归一化坐标 (0..1) → 栅格坐标
        const isNormalized = fa >= 0 && fa <= 1 && fb >= 0 && fb <= 1
          && (rows > 1 || cols > 1);
        const r = isNormalized ? Math.round(fb * (rows - 1)) : Math.round(fa);
        const c = isNormalized ? Math.round(fa * (cols - 1)) : Math.round(fb);
        const clampR = Math.max(0, Math.min(rows - 1, r));
        const clampC = Math.max(0, Math.min(cols - 1, c));
        return { x: clampC, y: clampR, regionIdx: i };
      });
    }
    if (typeof first === 'number') {
      const positions = (parsed as number[]).map(p => Math.max(1, Math.min(9, Math.round(p))));
      const regions = positions.map((position, i) => ({
        name: `zone_${i + 1}`,
        area: areas[i] ?? 1,
        position,
      }));
      return placeSeedPoints(regions, rows, cols, usableCells, rng);
    }
  }

  if (Array.isArray(parsed) && Array.isArray((parsed as unknown[])[0])) {
    const grid = parsed as Grid;
    const centers = extractCentersFromGrid(grid);
    return centers.map(([r, c], i) => ({ x: c, y: r, regionIdx: i }));
  }

  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Grid)[0])) {
    const centers = extractCentersFromGrid(parsed as Grid);
    return centers.map(([r, c], i) => ({ x: c, y: r, regionIdx: i }));
  }

  const positionsRaw = parseJson(input.positions);
  if (Array.isArray(positionsRaw) && positionsRaw.length > 0) {
    const positions = (positionsRaw as number[]).map(p => Math.max(1, Math.min(9, Math.round(p))));
    const regions = positions.map((position, i) => ({
      name: `zone_${i + 1}`,
      area: areas[i] ?? 1,
      position,
    }));
    return placeSeedPoints(regions, rows, cols, usableCells, rng);
  }

  return [];
}

/** point2d 列表 → 每分区拉伸系数（x→水平、y→竖直，>1 沿该轴拉长）。缺省/越界补 1（正圆）。 */
function parseStretchShapes(raw: unknown, count: number): SeedShape[] {
  const arr = Array.isArray(raw) ? raw : [];
  const shapes: SeedShape[] = [];
  for (let i = 0; i < count; i++) {
    const p = arr[i];
    const px = p && typeof p === 'object' ? (p as { x?: unknown }).x : undefined;
    const py = p && typeof p === 'object' ? (p as { y?: unknown }).y : undefined;
    const sx = typeof px === 'number' && Number.isFinite(px) ? Math.max(0.25, Math.min(4, px)) : 1;
    const sy = typeof py === 'number' && Number.isFinite(py) ? Math.max(0.25, Math.min(4, py)) : 1;
    shapes.push({ sx, sy });
  }
  return shapes;
}

/** 解析面积权重列表（相对比例，内部归一化）。 */
function parseAreas(raw: unknown, count: number): number[] {
  const parsed = parseJson(raw);
  if (Array.isArray(parsed) && parsed.length > 0) {
    return parsed.map(v => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? Math.max(0, n) : 1;
    });
  }
  if (count > 0) return new Array(count).fill(1);
  return [];
}

function labelToPartition(
  label: Int32Array,
  mask: Int32Array,
  rows: number,
  cols: number,
  zoneCount: number,
): Grid[] {
  const partition: Grid[] = [];
  for (let k = 0; k < zoneCount; k++) {
    const grid = emptyGrid(rows, cols);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (mask[idx] && label[idx] === k) grid[r][c] = 1;
      }
    }
    partition.push(grid);
  }
  return partition;
}

export function regionAreaPartition(input: Record<string, unknown>): Record<string, unknown> {
  const boundaryStyle = typeof input.boundaryStyle === 'string' ? input.boundaryStyle : 'organic';
  const relaxIterations = typeof input.relaxIterations === 'number' ? input.relaxIterations : 6;
  const smoothIterations = typeof input.smoothIterations === 'number' ? input.smoothIterations : 10;
  const seed = typeof input.seed === 'number' ? input.seed : 0;
  const edgeNoise = typeof input.edgeNoise === 'number' ? Math.max(0, input.edgeNoise) : 2.5;

  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { partition: [], count: 0 };
  }

  const rows = region.length;
  const cols = region[0].length;

  const usableCells: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (region[r][c] !== 0) usableCells.push([r, c]);
    }
  }
  if (usableCells.length === 0) return { partition: [], count: 0 };

  const rng = makeMRng(seed === 0 ? Date.now() : seed);

  const preAreas = parseAreas(input.areas, 0);
  const seeds = parseCenterSeeds(input, preAreas, rows, cols, usableCells, rng);
  if (seeds.length === 0) return { partition: [], count: 0 };

  const areas = preAreas.length >= seeds.length
    ? preAreas.slice(0, seeds.length)
    : [...preAreas, ...new Array(seeds.length - preAreas.length).fill(1)];

  const rawRatios = areas.map(a => Math.max(0, a));
  const ratioSum = rawRatios.reduce((s, v) => s + v, 0);
  const areaRatios = ratioSum <= 0
    ? rawRatios.map(() => 1 / seeds.length)
    : rawRatios.map(r => r / ratioSum);

  const mask = new Int32Array(rows * cols);
  for (const [r, c] of usableCells) mask[r * cols + c] = 1;

  const shapes = parseStretchShapes(input.stretch, seeds.length);
  const warp = buildWarpField(rows, cols, seed || 7, edgeNoise);

  const { seeds: relaxedSeeds, label } = lloydRelax(
    seeds, areaRatios, usableCells, rows, cols, Math.max(0, relaxIterations), shapes, warp,
  );

  const processedLabel = applyBoundaryStyle(
    boundaryStyle, label, mask, rows, cols,
    relaxedSeeds.map(s => ({ x: s.x, y: s.y })),
    areaRatios, Math.max(1, smoothIterations),
  );

  const partition = labelToPartition(processedLabel, mask, rows, cols, seeds.length);
  return { partition, count: partition.length };
}

export default regionAreaPartition;
