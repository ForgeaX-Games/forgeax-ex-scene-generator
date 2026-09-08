/**
 * townIslandLayout: 城镇岛状布局生成器（DataTree 单网格形态）
 *
 * DataTree 数据格式：输入 inputGrid 与输出 outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 *
 * 输入：
 *   inputGrid         (grid)    — 单张源掩码网格，所有非零单元格视为可生成道路的区域
 *   roadWidth         (number)  — 道路宽度，默认 1
 *   blockMinSize      (number)  — BSP块最小边长，控制路网与地块密度，默认 3
 *   shapeType         (string)  — 岛型形状：circle / ellipse / organic，默认 ellipse
 *   shapeScale        (number)  — 岛型面积占bbox面积比例（0.2–0.9），默认 0.6
 *   coverageThreshold (number)  — 地块保留覆盖率阈值（0–1），默认 0.6
 *   seed              (number)  — 随机种子（0 = 当前时间戳）
 *
 * 输出：
 *   outputGrid     (grid)  — 单张多值网格：道路=1，各地块从 2 起递增 id
 *   outputNameList (array) — [{id:1,name:'道路'}, {id:2,name:'地块 1'}, ...]，与网格 id 一一对应
 */

import { generateTownIsland, type TownIslandOptions } from "./generator";

/** 判断 v 是单张网格 number[][] */
function isGrid(v: unknown): v is number[][] {
  if (!Array.isArray(v) || v.length === 0) return false;
  const first = (v as unknown[])[0];
  if (!Array.isArray(first) || (first as unknown[]).length === 0) return false;
  return typeof (first as unknown[])[0] === "number";
}

export function townIslandLayout(input: Record<string, unknown>): Record<string, unknown> {
  const rawGrid = input.inputGrid;
  if (!isGrid(rawGrid)) {
    return { error: "inputGrid is required (number[][])", outputGrid: [], outputNameList: [] };
  }
  const inputGrid = rawGrid as number[][];

  const baseSeed = typeof input.seed === "number" ? Math.round(input.seed) : 0;

  const opts: TownIslandOptions = {
    roadWidth:         clampInt(input.roadWidth,           1, 10,  1),
    blockMinSize:      clampInt(input.blockMinSize,        2, 200, 3),
    shapeType:         pickOption(input.shapeType, ["circle", "ellipse", "organic"], "ellipse"),
    shapeScale:        clampFloat(input.shapeScale,        0.2, 0.9, 0.6),
    coverageThreshold: clampFloat(input.coverageThreshold, 0,   1,   0.6),
    seed:              baseSeed,
  };

  const { road, parcels, nameList } = generateTownIsland(inputGrid, opts);
  const rows = road.length;
  const cols = road[0]?.length ?? 0;

  // 单张多值网格：道路 id=1，各地块 pid 重映射为 2,3,4...
  const ROAD_ID = 1;
  const pidToId = new Map<number, number>();
  let nextId = 2;
  const outputNameList: { id: number; name: string; type: string }[] = [
    { id: ROAD_ID, name: "道路", type: "tile" },
  ];
  for (const entry of nameList) {
    const newId = nextId++;
    pidToId.set(entry.id, newId);
    outputNameList.push({ id: newId, name: entry.name, type: entry.type });
  }

  const outputGrid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pid = parcels[r][c];
      if (pid > 0 && pidToId.has(pid)) {
        outputGrid[r][c] = pidToId.get(pid)!;
      } else if (road[r][c] !== 0) {
        outputGrid[r][c] = ROAD_ID;
      }
    }
  }

  // 仅保留实际出现的条目（道路或地块可能为空）
  const present = new Set<number>();
  for (const rowArr of outputGrid) for (const v of rowArr) if (v !== 0) present.add(v);
  const filteredNameList = outputNameList.filter(e => present.has(e.id));

  return { outputGrid, outputNameList: filteredNameList };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function pickOption(value: unknown, options: string[], fallback: string): string {
  if (typeof value === "string" && options.includes(value)) return value;
  return fallback;
}
