/**
 * furniture_placer: 根据家具模板库和主家具清单，将家具放置到室内空间网格中
 * 输入：roomGrid   (grid)  — 室内空间网格（1=可用，0=墙）
 *       maskA      (grid)  — 家具实体占用网格（来自 room_mask_init 或上一轮放置；无旧家具时传全零网格）
 *       maskB      (grid)  — 过道预留网格（来自 room_mask_init 或上一轮放置；无旧家具时传全零网格）
 *       oldFurnitureIndex (array) — 旧家具编号列表（无旧家具时传 []）
 *       furnitureList     (array) — 主家具清单（来自 furniture_rank_split 的 main_list）
 * 输出：newMaskA         (grid)  — 更新后的家具实体网格
 *       newMaskB         (grid)  — 更新后的过道预留网格
 *       furnitureIndex   (array) — 所有家具编号列表（旧+新），每项 {rank, name, isGroup}
 */

import { Grid, FurnitureListItem, FurnitureIndexEntry, calcPlacedDirection, calcGroupSlotDirection } from "./types";
import {
  buildSingleLibrary, buildGroupLibrary, placeAll,
} from "./algorithm";
import singleLibraryData from "./simple_furniture_demo.json";
import groupLibraryData from "./desk_chair_set.json";

export function furniturePlacer(input: Record<string, unknown>): Record<string, unknown> {
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
    // main_list 为空时直接透传，避免链路中断
    const existingIdx: FurnitureIndexEntry[] = Array.isArray(oldFurnitureIndex) ? oldFurnitureIndex : [];
    return {
      newMaskA: maskA,
      newMaskB: maskB,
      furnitureIndex: existingIdx,
      diagnostics: ["furnitureList 为空，跳过放置"],
    };
  }

  // 计算旧家具最大 rank，新家具编号从 rankOffset + rank 开始
  const existingIndex: FurnitureIndexEntry[] = Array.isArray(oldFurnitureIndex)
    ? oldFurnitureIndex
    : [];
  const rankOffset = existingIndex.reduce((max, e) => Math.max(max, e.rank), 0);

  // 将 roomGrid 二值化：任何非零值视为可用格子（1），0 保持为墙
  // 这使得电池兼容所有室内布局格式（bh_college: 0=墙/1=走廊/10+=房间, complex_indoor: 0=墙/1=房/2=廊/3=门）
  const binaryRoomGrid: Grid = roomGrid.map(row => row.map(v => (v !== 0 ? 1 : 0)));

  const singleLib = buildSingleLibrary(singleLibraryData);
  const groupLib = buildGroupLibrary(groupLibraryData);

  // 按 placement 分拣
  const sorted = [...furnitureList].sort((a, b) => a.rank - b.rank);
  const edgeItems = sorted.filter(i => (i.placement ?? "edge") === "edge");
  const centerItems = sorted.filter(i => i.placement === "center");

  const { maskA: newMaskA, maskB: newMaskB, placed, diagnostics } = placeAll(
    binaryRoomGrid, maskA, maskB,
    singleLib, groupLib,
    edgeItems, centerItems,
    rankOffset,
    seed
  );

  // 构建输出家具编号列表：保留旧条目 + 追加新条目
  // group 家具每个编号槽（effectiveRank ~ effectiveRank+slots-1）各生成一条记录
  // slot i 对应 mask 值 i+1，优先用 components["i+1"] 作为子名，拼成 "家具名_子名"
  const newEntries: FurnitureIndexEntry[] = [];
  for (const p of placed) {
    const overallDirection = calcPlacedDirection(p);
    for (let i = 0; i < p.groupSlots; i++) {
      const slotIndex = i + 1;  // 1-based，1=桌,2=椅...
      const maskKey = String(slotIndex);
      const subLabel = p.components[maskKey];
      const entryName = subLabel ? `${p.name}_${subLabel}` : (i === 0 ? p.name : `${p.name}_组件${i}`);
      const direction = p.isGroup
        ? calcGroupSlotDirection(p.templateMask, slotIndex, overallDirection)
        : overallDirection;
      newEntries.push({
        rank: p.effectiveRank + i,
        name: entryName,
        isGroup: p.isGroup,
        direction,
      });
    }
  }

  const furnitureIndex: FurnitureIndexEntry[] = [
    ...existingIndex,
    ...newEntries,
  ];

  return { newMaskA, newMaskB, furnitureIndex, diagnostics };
}
