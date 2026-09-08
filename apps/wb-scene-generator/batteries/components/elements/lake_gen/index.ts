/**
 * lakeGen: Generate organic lakes inside a designated area of a single mask grid.
 *
 * DataTree 数据格式：输入 inputGrid 与输出 outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 *
 * Inputs:
 *   inputGrid    (grid)    — single source mask grid
 *   targetId     (number)  — cell value marking valid placement area
 *   lakeCount    (number)  — how many lakes to generate
 *   lakeSize     (number)  — target size of each lake in cells
 *   sizeVariance (number)  — size randomness factor 0–1 (0 = all same size)
 *   minSpacing   (number)  — minimum gap between any two lakes (cells)
 *   lakeBaseId   (number)  — starting mask ID for lakes (0 = auto: max+1)
 *   seed         (number)  — random seed (0 = current timestamp)
 *
 * Outputs:
 *   outputGrid     (grid)  — single multi-value grid, each lake an increasing id
 *   outputNameList (array) — one entry per lake [{id, name, type}]
 */

import { generateLakes, type GenerateOptions } from "./generator";

/** 判断 v 是单张网格 number[][] */
function isGrid(v: unknown): v is number[][] {
  if (!Array.isArray(v) || v.length === 0) return false;
  const first = (v as unknown[])[0];
  if (!Array.isArray(first) || (first as unknown[]).length === 0) return false;
  return typeof (first as unknown[])[0] === "number";
}

export function lakeGen(input: Record<string, unknown>): Record<string, unknown> {
  const rawGrid = input.inputGrid;
  if (!isGrid(rawGrid)) {
    return { error: "inputGrid is required (number[][])", outputGrid: [], outputNameList: [] };
  }
  const inputGrid = rawGrid as number[][];

  const baseSeed = typeof input.seed === "number" ? Math.round(input.seed) : 0;

  const opts: GenerateOptions = {
    targetId:     typeof input.targetId     === "number" ? Math.round(input.targetId)                   : 1,
    lakeCount:    typeof input.lakeCount    === "number" ? Math.max(1, Math.round(input.lakeCount))     : 3,
    lakeSize:     typeof input.lakeSize     === "number" ? Math.max(1, Math.round(input.lakeSize))      : 50,
    sizeVariance: typeof input.sizeVariance === "number" ? Math.max(0, Math.min(1, input.sizeVariance)) : 0.3,
    minSpacing:   typeof input.minSpacing   === "number" ? Math.max(0, Math.round(input.minSpacing))    : 3,
    lakeBaseId:   typeof input.lakeBaseId   === "number" ? Math.round(input.lakeBaseId)                 : 0,
    seed:         baseSeed,
  };

  const rows = inputGrid.length;
  const cols = inputGrid[0].length;
  const lakes = generateLakes(inputGrid, opts);

  // 单张多值网格：每个湖泊一个递增 id
  const outputGrid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const outputNameList: { id: number; name: string; type: string }[] = [];
  for (const lake of lakes) {
    for (const [r, c] of lake.cells) outputGrid[r][c] = lake.id;
    outputNameList.push({ id: lake.id, name: lake.name, type: "tile" });
  }

  return { outputGrid, outputNameList };
}
