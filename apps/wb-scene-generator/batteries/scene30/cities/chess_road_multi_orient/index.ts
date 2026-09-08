/**
 * chessRoadMultiOrient: 多朝向组合棋盘格道路生成器
 *
 * Inputs:
 *   inputGrid      (grid)   — 源掩码网格；所有非零单元格均视为可用区域
 *   mainSpacing    (number) — 主路间距（单元格数），默认 24
 *   subSpacing     (number) — 辅路间距（单元格数），默认 8
 *   mainRoadWidth  (number) — 主路宽度，默认 2
 *   subRoadWidth   (number) — 辅路宽度，默认 1
 *   zoneCount      (number) — Voronoi 子区数量，默认 4
 *   minParcelSize  (number) — 最小地块面积（格数），小于此值转为辅路，0=不过滤，默认 16
 *   seed           (number) — 随机种子（0 = 当前时间戳）
 *
 * Outputs:
 *   mainRoad (grid)  — 主路掩码：主路单元格 = 1，其余 = 0
 *   subRoad  (grid)  — 辅路掩码：辅路单元格 = 1，其余 = 0
 *   parcels  (grid)  — 多值地块：每块唯一ID（1, 2, 3…），非地块 = 0
 *   nameList (array) — [{id, name}] 地块名称清单
 */

import { generateMultiOrientRoad, type MultiOrientOptions } from "./generator";

export function chessRoadMultiOrient(input: Record<string, unknown>): Record<string, unknown> {
  const inputGrid = input.inputGrid as number[][] | undefined;
  if (!Array.isArray(inputGrid) || inputGrid.length === 0) {
    return { error: "inputGrid is required", mainRoad: [], subRoad: [], parcels: [] };
  }

  const opts: MultiOrientOptions = {
    mainSpacing:   typeof input.mainSpacing    === "number" ? Math.max(4, Math.round(input.mainSpacing))    : 24,
    subSpacing:    typeof input.subSpacing     === "number" ? Math.max(2, Math.round(input.subSpacing))     : 8,
    mainRoadWidth: typeof input.mainRoadWidth  === "number" ? Math.max(1, Math.round(input.mainRoadWidth))  : 2,
    subRoadWidth:  typeof input.subRoadWidth   === "number" ? Math.max(1, Math.round(input.subRoadWidth))   : 1,
    zoneCount:     typeof input.zoneCount      === "number" ? Math.max(1, Math.round(input.zoneCount))      : 4,
    minParcelSize: typeof input.minParcelSize  === "number" ? Math.max(0, Math.round(input.minParcelSize))  : 16,
    seed:          typeof input.seed           === "number" ? Math.round(input.seed)                        : 0,
  };

  const { mainRoad, subRoad, parcels, nameList } = generateMultiOrientRoad(inputGrid, opts);
  return { mainRoad, subRoad, parcels, nameList };
}
