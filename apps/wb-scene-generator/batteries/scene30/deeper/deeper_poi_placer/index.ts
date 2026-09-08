/**
 * deeperPoiPlacer: 深空 POI 放置器
 * 输入：groundGrid/densityGrid (grid) — 来自 deeper_density_field;
 *       poiList (array) — POI 规则列表 [{name, count, minDist}];
 *       globalMinDist (number) — 全局最小间距; densityInfluence (number) — 密度影响权重; seed (number)
 * 输出：outputGridList (array) — 每种 POI 的单值掩码网格列表;
 *       outputNameList (array) — 与列表一一对应的名称清单;
 *       roadGrid (grid) — 未被 POI 覆盖的道路网格;
 *       mergedGrid (grid) — 所有 POI 合并到同一张网格;
 *       placedCount (number) — 成功放置的 POI 总数
 */

import {
  LCG,
  placeAllPoi,
  buildOutputGrids,
  buildRoadGrid,
  buildMergedGrid,
  type PoiSpec,
} from "./placer.js";

/** 解析 poiList 输入，支持多种格式 */
function parsePoiList(raw: unknown): PoiSpec[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];

  const specs: PoiSpec[] = [];
  for (const item of arr as unknown[]) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;

    // 标准格式：{name, count, minDist}
    if (typeof obj.name === "string") {
      specs.push({
        name: obj.name,
        count: typeof obj.count === "number" ? Math.max(1, Math.round(obj.count)) : 5,
        minDist: typeof obj.minDist === "number" ? Math.max(1, obj.minDist) : 4,
      });
      continue;
    }

    // 简化格式：单键对象，键=名称，值="count:minDist" 或 count 数值
    const keys = Object.keys(obj);
    if (keys.length === 0) continue;
    const name = keys[0];
    const val = obj[name];
    if (typeof val === "number") {
      specs.push({ name, count: Math.max(1, Math.round(val)), minDist: 4 });
    } else if (typeof val === "string") {
      const parts = val.split(/[：:，,]+/).map(Number);
      specs.push({
        name,
        count: isNaN(parts[0]) ? 5 : Math.max(1, Math.round(parts[0])),
        minDist: isNaN(parts[1]) ? 4 : Math.max(1, parts[1]),
      });
    }
  }
  return specs;
}

function gridMax(grid: number[][]): number {
  let max = 0;
  for (const row of grid) for (const v of row) if (v > max) max = v;
  return max;
}

export function deeperPoiPlacer(input: Record<string, unknown>): Record<string, unknown> {
  const groundGrid  = input.groundGrid  as number[][] | undefined;
  const densityGrid = input.densityGrid as number[][] | undefined;

  if (!groundGrid  || groundGrid.length  === 0) return { error: "groundGrid is required" };
  if (!densityGrid || densityGrid.length === 0) return { error: "densityGrid is required" };

  const rows = groundGrid.length;
  const cols = groundGrid[0]?.length ?? 0;
  if (cols === 0) return { error: "groundGrid has no columns" };

  const specs = parsePoiList(input.poiList);
  if (specs.length === 0) return { error: "poiList must be a non-empty array of {name, count, minDist}" };

  const globalMinDist    = typeof input.globalMinDist    === "number" ? Math.max(1, input.globalMinDist)    : 2;
  const densityInfluence = typeof input.densityInfluence === "number"
    ? Math.min(1, Math.max(0, input.densityInfluence))
    : 1.0;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const rng = new LCG(baseSeed);

  // POI id 从 groundGrid 最大值 + 1 开始，避免与地面 id 冲突
  const baseId = gridMax(groundGrid) + 1;

  const { perTypePoints, nameEntries, totalCount } = placeAllPoi(
    groundGrid,
    densityGrid,
    specs,
    baseId,
    globalMinDist,
    densityInfluence,
    rng,
  );

  const { outputGridList, alignedNameList } = buildOutputGrids(
    perTypePoints,
    nameEntries,
    rows,
    cols,
    baseId,
    specs,
  );

  const roadGrid   = buildRoadGrid(groundGrid, perTypePoints, rows, cols);
  const mergedGrid = buildMergedGrid(groundGrid, perTypePoints, nameEntries, rows, cols);

  return {
    outputGridList,
    outputNameList: alignedNameList,
    roadGrid,
    mergedGrid,
    placedCount: totalCount,
  };
}
