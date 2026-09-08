/**
 * chessRoadJitter: 路段分节抖动棋盘格道路生成器
 *
 * Inputs:
 *   inputGrid     (grid)   — 源掩码网格；所有非零单元格均视为可用区域
 *   mainSpacing   (number) — 主路间距（单元格数），默认 30
 *   subSpacing    (number) — 辅路间距（单元格数），默认 20
 *   mainRoadWidth (number) — 主路宽度，默认 4
 *   subRoadWidth  (number) — 辅路宽度，默认 2
 *   jitterAmp     (number) — 最大抖动幅度（格数），默认 1
 *   segmentCount  (number) — 每段分节数，默认 5
 *   seed          (number) — 随机种子（0 = 当前时间戳）
 *
 * Outputs:
 *   mainRoad (grid)  — 主路掩码：主路单元格 = 1，其余 = 0
 *   subRoad  (grid)  — 辅路掩码：辅路单元格 = 1，其余 = 0
 *   parcels  (grid)  — 多值地块：每块唯一ID（1, 2, 3…），非地块 = 0
 *   nameList (array) — [{id, name}] 地块名称清单
 */

import { generateJitterRoad, type JitterRoadOptions } from "./generator";

export function chessRoadJitter(input: Record<string, unknown>): Record<string, unknown> {
  const inputGrid = input.inputGrid as number[][] | undefined;
  if (!Array.isArray(inputGrid) || inputGrid.length === 0) {
    return { error: "inputGrid is required", mainRoad: [], subRoad: [], parcels: [] };
  }

  const opts: JitterRoadOptions = {
    mainSpacing:   typeof input.mainSpacing   === "number" ? Math.max(4, Math.round(input.mainSpacing))   : 30,
    subSpacing:    typeof input.subSpacing    === "number" ? Math.max(2, Math.round(input.subSpacing))    : 20,
    mainRoadWidth: typeof input.mainRoadWidth === "number" ? Math.max(1, Math.round(input.mainRoadWidth)) : 4,
    subRoadWidth:  typeof input.subRoadWidth  === "number" ? Math.max(1, Math.round(input.subRoadWidth))  : 2,
    jitterAmp:     typeof input.jitterAmp     === "number" ? Math.max(0, input.jitterAmp)                 : 1,
    segmentCount:  typeof input.segmentCount  === "number" ? Math.max(2, Math.round(input.segmentCount))  : 5,
    seed:          typeof input.seed          === "number" ? Math.round(input.seed)                       : 0,
  };

  const { mainRoad, subRoad, parcels, nameList } = generateJitterRoad(inputGrid, opts);
  return { mainRoad, subRoad, parcels, nameList };
}
