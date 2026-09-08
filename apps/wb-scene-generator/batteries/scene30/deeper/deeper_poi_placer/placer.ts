/**
 * placer.ts — 密度加权 POI 放置核心算法
 */

export class LCG {
  private state: number;
  constructor(seed: number) {
    this.state = (seed === 0 ? Date.now() : seed) >>> 0;
    if (this.state === 0) this.state = 0x6d2b79f5;
  }
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
  int(min: number, max: number): number {
    if (max <= min) return min;
    return min + Math.floor(this.next() * (max - min + 1));
  }
}

export interface PoiSpec {
  name: string;
  count: number;
  minDist: number;
}

export interface NameEntry {
  id: number;
  name: string;
}

interface PlacedPoint {
  row: number;
  col: number;
}

/**
 * 构建密度加权的候选格子列表
 * 每个格子按其密度权重重复放入候选池（权重越高被抽中概率越高）
 * 为控制候选池大小，将权重映射到 1–20 的整数重复次数
 */
function buildWeightedCandidates(
  groundGrid: number[][],
  densityGrid: number[][],
  densityInfluence: number,
  rows: number,
  cols: number,
): Array<[number, number]> {
  const candidates: Array<[number, number]> = [];
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (groundGrid[r][c] === 0) continue;

      const rawDensity = (densityGrid[r]?.[c] ?? 0) / 100; // 0–1
      // 线性混合：densityInfluence=0 → 均匀权重1；=1 → 纯密度权重
      const w = (1 - densityInfluence) + densityInfluence * rawDensity;
      const repeats = clamp(Math.round(w * 20), 1, 20);
      for (let k = 0; k < repeats; k++) {
        candidates.push([r, c]);
      }
    }
  }
  return candidates;
}

/** Fisher-Yates 洗牌（原地，返回前 n 个元素） */
function shuffleTake<T>(arr: T[], n: number, rng: LCG): T[] {
  const len = arr.length;
  const take = Math.min(n, len);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng.next() * (len - i));
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr.slice(0, take);
}

/** 判断新点与已放置点的最小间距约束 */
function tooClose(row: number, col: number, placed: PlacedPoint[], minDist: number): boolean {
  const d2 = minDist * minDist;
  for (const p of placed) {
    const dr = p.row - row, dc = p.col - col;
    if (dr * dr + dc * dc < d2) return true;
  }
  return false;
}

/**
 * 放置所有 POI 种类
 * @returns placed: 每种 POI 已放置的点集; allPlaced: 全局放置点（含所有种类，用于全局间距约束）
 */
export function placeAllPoi(
  groundGrid: number[][],
  densityGrid: number[][],
  specs: PoiSpec[],
  baseId: number,
  globalMinDist: number,
  densityInfluence: number,
  rng: LCG,
): { perTypePoints: PlacedPoint[][]; nameEntries: NameEntry[]; totalCount: number } {
  const rows = groundGrid.length;
  const cols = groundGrid[0]?.length ?? 0;
  if (rows === 0 || cols === 0 || specs.length === 0) {
    return { perTypePoints: [], nameEntries: [], totalCount: 0 };
  }

  const candidates = buildWeightedCandidates(groundGrid, densityGrid, densityInfluence, rows, cols);
  if (candidates.length === 0) {
    return { perTypePoints: [], nameEntries: [], totalCount: 0 };
  }

  const allPlaced: PlacedPoint[] = [];
  const perTypePoints: PlacedPoint[][] = [];
  const nameEntries: NameEntry[] = [];
  let totalCount = 0;
  let currentId = baseId;

  for (let si = 0; si < specs.length; si++) {
    const spec = specs[si];
    const poiId = currentId++;
    const effectiveMinDist = Math.max(globalMinDist, spec.minDist);

    // 每种 POI 用不同偏移种子洗牌候选池
    const rngOffset = new LCG((rng.next() * 0x7fffffff) >>> 0);
    // 复制候选池以独立洗牌
    const pool = candidates.slice();
    const shuffled = shuffleTake(pool, pool.length, rngOffset);

    const typePlaced: PlacedPoint[] = [];
    let placed = 0;

    for (const [r, c] of shuffled) {
      if (placed >= spec.count) break;
      if (groundGrid[r][c] === 0) continue;
      if (tooClose(r, c, allPlaced, globalMinDist)) continue;
      if (tooClose(r, c, typePlaced, effectiveMinDist)) continue;

      const pt: PlacedPoint = { row: r, col: c };
      typePlaced.push(pt);
      allPlaced.push(pt);
      placed++;
    }

    if (placed > 0) {
      perTypePoints.push(typePlaced);
      nameEntries.push({ id: poiId, name: spec.name });
      totalCount += placed;
    } else {
      // 没放置任何点，仍占位以保持 id 连续（但不放入 nameEntries）
      perTypePoints.push([]);
    }
  }

  return { perTypePoints, nameEntries, totalCount };
}

/**
 * 将 perTypePoints 展开为每种 POI 的单值掩码网格列表
 */
export function buildOutputGrids(
  perTypePoints: PlacedPoint[][],
  nameEntries: NameEntry[],
  rows: number,
  cols: number,
  baseId: number,
  specs: PoiSpec[],
): { outputGridList: number[][][]; alignedNameList: NameEntry[] } {
  const outputGridList: number[][][] = [];
  const alignedNameList: NameEntry[] = [];

  // nameEntries 只包含实际有放置点的 POI，需要配合 perTypePoints 重建 id
  let nameIdx = 0;
  for (let si = 0; si < specs.length && si < perTypePoints.length; si++) {
    const points = perTypePoints[si];
    if (points.length === 0) continue;

    const entry = nameEntries[nameIdx++];
    const singleGrid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (const { row, col } of points) {
      singleGrid[row][col] = entry.id;
    }
    outputGridList.push(singleGrid);
    alignedNameList.push(entry);
  }

  return { outputGridList, alignedNameList };
}

/**
 * 生成道路网格：地面底图中未被任何 POI 覆盖的格子值=1，覆盖区=0
 */
export function buildRoadGrid(
  groundGrid: number[][],
  perTypePoints: PlacedPoint[][],
  rows: number,
  cols: number,
): number[][] {
  const road: number[][] = groundGrid.map(row => [...row]);
  for (const points of perTypePoints) {
    for (const { row, col } of points) {
      road[row][col] = 0;
    }
  }
  return road;
}

/**
 * 生成合并网格：每种 POI 写入各自 id，道路格子保持 groundGrid 原值（1），未使用格子=0
 */
export function buildMergedGrid(
  groundGrid: number[][],
  perTypePoints: PlacedPoint[][],
  nameEntries: NameEntry[],
  rows: number,
  cols: number,
): number[][] {
  const merged: number[][] = groundGrid.map(row => [...row]);
  let nameIdx = 0;
  for (const points of perTypePoints) {
    if (points.length === 0) continue;
    const entry = nameEntries[nameIdx++];
    for (const { row, col } of points) {
      merged[row][col] = entry.id;
    }
  }
  return merged;
}
