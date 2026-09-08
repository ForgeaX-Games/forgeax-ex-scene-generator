/**
 * furniture_filler: 将填充家具反复放置到室内空间网格中，直到占用率上限或连续失败
 * 输入：roomGrid         (grid)  — 室内空间网格（1=可用，0=墙）
 *       maskA            (grid)  — 家具实体占用网格（来自单一家具放置器；无旧家具时传全零网格）
 *       maskB            (grid)  — 过道预留网格（来自单一家具放置器；无旧家具时传全零网格）
 *       oldFurnitureIndex (array) — 旧家具编号列表（无旧家具时传 []）
 *       furnitureList     (array) — 填充家具清单（来自 furniture_rank_split 的 fill_list）
 * 输出：newMaskA         (grid)  — 更新后的家具实体网格
 *       newMaskB         (grid)  — 更新后的过道预留网格
 *       furnitureIndex   (array) — 所有家具编号列表（旧+新），每项 {rank, name, isGroup}
 *       diagnostics      (array) — 填充过程诊断日志
 */

import { Grid, FurnitureListItem, FurnitureIndexEntry, calcPlacedDirection, calcGroupSlotDirection } from "./types";
import { buildSingleLibrary, buildGroupLibrary, fillAll } from "./filler_algorithm";
import singleLibraryData from "./simple_furniture_demo.json";
import groupLibraryData from "./desk_chair_set.json";

export function furnitureFiller(input: Record<string, unknown>): Record<string, unknown> {
  const roomGrid = input.roomGrid as Grid | undefined;
  const maskA = input.maskA as Grid | undefined;
  const maskB = input.maskB as Grid | undefined;
  const oldFurnitureIndex = input.oldFurnitureIndex as FurnitureIndexEntry[] | undefined;
  const furnitureList = input.furnitureList as FurnitureListItem[] | undefined;
  const seed = typeof input.seed === "number" ? Math.floor(input.seed) : 42;

  if (!roomGrid || !Array.isArray(roomGrid) || roomGrid.length === 0) {
    return { error: "roomGrid is required and must be a non-empty 2D array" };
  }
  if (!maskA || !Array.isArray(maskA)) {
    return { error: "maskA is required (pass all-zero grid if no existing furniture)" };
  }
  if (!maskB || !Array.isArray(maskB)) {
    return { error: "maskB is required (pass all-zero grid if no existing furniture)" };
  }
  if (!Array.isArray(furnitureList) || furnitureList.length === 0) {
    // fill_list 为空时（LLM 未推理出 rank 8-9 的填充家具）直接透传，不报错
    const existingIdx: FurnitureIndexEntry[] = Array.isArray(oldFurnitureIndex) ? oldFurnitureIndex : [];
    return {
      newMaskA: maskA,
      newMaskB: maskB,
      furnitureIndex: existingIdx,
      diagnostics: ["fill_list 为空，跳过填充"],
    };
  }

  const existingIndex: FurnitureIndexEntry[] = Array.isArray(oldFurnitureIndex)
    ? oldFurnitureIndex
    : [];
  // 旧家具最大编号，新填充家具编号 = rankOffset + rank
  const rankOffset = existingIndex.reduce((max, e) => Math.max(max, e.rank), 0);

  // 将 roomGrid 二值化：任何非零值视为可用格子（1），0 保持为墙
  // 兼容所有室内布局格式（bh_college: 0=墙/1=走廊/10+=房间, complex_indoor: 0=墙/1=房/2=廊/3=门）
  const binaryRoomGrid: Grid = roomGrid.map(row => row.map(v => (v !== 0 ? 1 : 0)));

  const singleLib = buildSingleLibrary(singleLibraryData);
  const groupLib = buildGroupLibrary(groupLibraryData);

  const sorted = [...furnitureList].sort((a, b) => a.rank - b.rank);

  const { maskA: newMaskA, maskB: newMaskB, placed, diagnostics } = fillAll(
    binaryRoomGrid, maskA, maskB,
    singleLib, groupLib,
    sorted,
    rankOffset,
    seed
  );

  // 每个实例有唯一 effectiveRank，直接生成独立条目
  // group 家具（桌椅组合）中椅子的 direction 由其相对桌子的位置决定
  const newEntries: FurnitureIndexEntry[] = placed.map(p => ({
    rank: p.effectiveRank,
    name: p.name,
    isGroup: p.isGroup,
    direction: p.isGroup
      ? calcGroupSlotDirection(p.templateMask, 1, calcPlacedDirection(p))
      : calcPlacedDirection(p),
  }));

  const subEntries: FurnitureIndexEntry[] = placed
    .filter(p => p.isGroup)
    .map(p => ({
      rank: p.effectiveRank + 10,
      name: `${p.name}_子组件`,
      isGroup: true,
      direction: calcGroupSlotDirection(p.templateMask, 2, calcPlacedDirection(p)),
    }));

  const furnitureIndex: FurnitureIndexEntry[] = [
    ...existingIndex,
    ...newEntries,
    ...subEntries,
  ].sort((a, b) => a.rank - b.rank);

  return { newMaskA, newMaskB, furnitureIndex, diagnostics };
}
