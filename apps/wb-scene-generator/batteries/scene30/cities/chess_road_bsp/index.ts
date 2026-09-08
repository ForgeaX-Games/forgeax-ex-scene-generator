/**
 * chessRoad: 两级 BSP 棋盘格道路生成器
 *
 * Inputs:
 *   inputGrid        (grid)   — 源掩码网格；所有非零单元格均视为可用区域
 *   mainRoadWidth    (number) — 主路宽度（单元格数），默认 2
 *   subRoadWidth     (number) — 辅路宽度（单元格数），默认 1
 *   mainBlockMinSize (number) — 主块最小尺寸，默认 20
 *   parcelMinSize    (number) — 地块最小尺寸，默认 8
 *   splitRatio       (number) — 分割比例下限（0–0.5），默认 0.4
 *   seed             (number) — 随机种子（0 = 当前时间戳）
 *
 * Outputs:
 *   mainRoad (grid)  — 主路掩码：主路单元格 = 1，其余 = 0
 *   subRoad  (grid)  — 辅路掩码：辅路单元格 = 1，其余 = 0
 *   parcels  (grid)  — 多值地块：每块唯一ID（1, 2, 3…），非地块 = 0
 *   nameList (array) — [{id, name}] 地块名称清单
 */

import { generateChessRoad, type ChessRoadOptions } from "./generator";

export function chessRoad(input: Record<string, unknown>): Record<string, unknown> {
  const inputGrid = input.inputGrid as number[][] | undefined;
  if (!Array.isArray(inputGrid) || inputGrid.length === 0) {
    return { error: "inputGrid is required", mainRoad: [], subRoad: [], parcels: [] };
  }

  const opts: ChessRoadOptions = {
    mainRoadWidth:    typeof input.mainRoadWidth    === "number" ? Math.max(1, Math.round(input.mainRoadWidth))            : 2,
    subRoadWidth:     typeof input.subRoadWidth     === "number" ? Math.max(1, Math.round(input.subRoadWidth))             : 1,
    mainBlockMinSize: typeof input.mainBlockMinSize === "number" ? Math.max(4, Math.round(input.mainBlockMinSize))         : 20,
    parcelMinSize:    typeof input.parcelMinSize    === "number" ? Math.max(2, Math.round(input.parcelMinSize))            : 8,
    splitRatio:       typeof input.splitRatio       === "number" ? Math.max(0, Math.min(0.5, input.splitRatio))           : 0.4,
    seed:             typeof input.seed             === "number" ? Math.round(input.seed)                                  : 0,
  };

  const { mainRoad, subRoad, parcels, nameList } = generateChessRoad(inputGrid, opts);
  return { mainRoad, subRoad, parcels, nameList };
}
