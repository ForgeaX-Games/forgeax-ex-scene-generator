/**
 * per_room_furniture_placer: 逐房间家具放置器
 * 对 layoutGrid 中每个独立连通房间分别执行 placer + filler，保证每个房间都有家具
 *
 * 输入：layoutGrid  (grid)  — 室内布局网格（complex_indoor_gen 输出：0=墙, 1=房间, 2=走廊, 3=门）
 *       mainList    (array) — 主家具清单（来自 furniture_rank_split 的 main_list）
 *       fillList    (array) — 填充家具清单（来自 furniture_rank_split 的 fill_list）
 *       seed        (number)— 随机种子；0 = 当前时间
 * 输出：newMaskA        (grid)  — 合并后所有房间的家具实体网格
 *       furnitureIndex  (array) — 所有房间家具编号列表 [{rank, name, isGroup}]
 */

import {
  Grid, FurnitureListItem, FurnitureIndexEntry, PlacedFurniture,
} from "../furniture_placer/types";
import {
  buildSingleLibrary, buildGroupLibrary, placeAll,
} from "../furniture_placer/algorithm";
import {
  buildSingleLibrary as buildSingleFill,
  buildGroupLibrary as buildGroupFill,
  fillAll,
} from "../furniture_filler/filler_algorithm";
import singleLibraryData from "../furniture_placer/simple_furniture_demo.json";
import groupLibraryData from "../furniture_placer/desk_chair_set.json";
import singleFillData from "../furniture_filler/simple_furniture_demo.json";
import groupFillData from "../furniture_filler/desk_chair_set.json";

type Cell = [number, number];

/** 连通区域检测：找出 layoutGrid 中所有值为 1 的独立连通块 */
function findRoomComponents(
  layoutGrid: Grid,
  rows: number,
  cols: number,
): { grid: Grid; area: number }[] {
  const visited: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const components: { grid: Grid; area: number }[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (layoutGrid[r][c] !== 1 || visited[r][c]) continue;

      const cells: Cell[] = [];
      const queue: Cell[] = [[r, c]];
      visited[r][c] = true;

      while (queue.length > 0) {
        const [cr, cc] = queue.shift()!;
        cells.push([cr, cc]);
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as Cell[]) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (
            nr >= 0 && nr < rows &&
            nc >= 0 && nc < cols &&
            !visited[nr][nc] &&
            layoutGrid[nr][nc] === 1
          ) {
            visited[nr][nc] = true;
            queue.push([nr, nc]);
          }
        }
      }

      const roomGrid: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
      for (const [pr, pc] of cells) roomGrid[pr][pc] = 1;
      components.push({ grid: roomGrid, area: cells.length });
    }
  }

  // 面积从大到小排序，保证大房间优先放置
  return components.sort((a, b) => b.area - a.area);
}

function makeZeroGrid(rows: number, cols: number): Grid {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

/**
 * 构建门口禁区集合：layoutGrid 中值=3 的门格本身，以及其上下左右各1格。
 * 家具 body 不得放置在禁区内，保证门口四个方向有通行空间。
 */
function buildDoorZone(layoutGrid: Grid, rows: number, cols: number): Set<string> {
  const zone = new Set<string>();
  const dirs: Array<[number, number]> = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (layoutGrid[r][c] !== 3) continue;
      for (const [dr, dc] of dirs) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          zone.add(`${nr},${nc}`);
        }
      }
    }
  }
  return zone;
}

export function perRoomFurniturePlacer(input: Record<string, unknown>): Record<string, unknown> {
  const layoutGrid = input.layoutGrid as Grid | undefined;
  const mainList = (input.mainList as FurnitureListItem[] | undefined) ?? [];
  const fillList = (input.fillList as FurnitureListItem[] | undefined) ?? [];
  const seedRaw = typeof input.seed === "number" ? Math.floor(input.seed) : 42;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;

  if (!layoutGrid || !Array.isArray(layoutGrid) || layoutGrid.length === 0) {
    return { error: "layoutGrid is required and must be a non-empty 2D array" };
  }

  const rows = layoutGrid.length;
  const cols = layoutGrid[0]?.length ?? 0;

  const doorZone = buildDoorZone(layoutGrid, rows, cols);

  // 构建家具模板库
  const singleLib = buildSingleLibrary(singleLibraryData);
  const groupLib = buildGroupLibrary(groupLibraryData);
  const singleFillLib = buildSingleFill(singleFillData);
  const groupFillLib = buildGroupFill(groupFillData);

  // 按 placement 分拣主家具
  const sorted = [...mainList].sort((a, b) => a.rank - b.rank);
  const edgeItems = sorted.filter(i => (i.placement ?? "edge") === "edge");
  const centerItems = sorted.filter(i => i.placement === "center");
  const hasFill = fillList.length > 0;

  // 每个房间的 rank 编号段占 RANK_STRIDE，防止不同房间的家具编号冲突
  const RANK_STRIDE = 1000;
  const MIN_ROOM_AREA = 6;

  const globalMaskA: Grid = makeZeroGrid(rows, cols);
  const allFurnitureIndex: FurnitureIndexEntry[] = [];

  const rooms = findRoomComponents(layoutGrid, rows, cols);

  for (let i = 0; i < rooms.length; i++) {
    const { grid: roomGrid, area } = rooms[i];
    if (area < MIN_ROOM_AREA) continue;

    const roomSeed = baseSeed + i * 999983;
    const baseRankOffset = i * RANK_STRIDE;
    const zeroA = makeZeroGrid(rows, cols);
    const zeroB = makeZeroGrid(rows, cols);

    // 第一步：主家具放置
    const { maskA: placedA, maskB: placedB, placed } = placeAll(
      roomGrid, zeroA, zeroB,
      singleLib, groupLib,
      edgeItems, centerItems,
      baseRankOffset,
      roomSeed,
      doorZone,
    );

    // 记录主家具的 index 条目
    for (const p of placed) {
      for (let j = 0; j < p.groupSlots; j++) {
        const maskKey = String(j + 1);
        const subLabel = p.components[maskKey];
        const entryName = subLabel
          ? `${p.name}_${subLabel}`
          : j === 0 ? p.name : `${p.name}_组件${j}`;
        allFurnitureIndex.push({ rank: p.effectiveRank + j, name: entryName, isGroup: p.isGroup });
      }
    }

    // 第二步：填充家具放置（接在主家具之后）
    let finalA = placedA;
    if (hasFill) {
      // fillOffset 从主家具最大编号之后开始
      const maxMainRank = placed.reduce(
        (max, p) => Math.max(max, p.effectiveRank + p.groupSlots - 1),
        baseRankOffset,
      );
      const { maskA: filledA, placed: filledPlaced } = fillAll(
        roomGrid, placedA, placedB,
        singleFillLib, groupFillLib,
        [...fillList].sort((a, b) => a.rank - b.rank),
        maxMainRank,
        roomSeed + 1,
        doorZone,
      );
      finalA = filledA;

      // 记录填充家具 index 条目（同一 rank 的填充家具可能出现多次，去重后只保留一条名称）
      const filledMap = new Map<number, FurnitureIndexEntry>();
      for (const p of filledPlaced) {
        if (!filledMap.has(p.effectiveRank)) {
          filledMap.set(p.effectiveRank, { rank: p.effectiveRank, name: p.name, isGroup: p.isGroup });
        }
      }
      allFurnitureIndex.push(...filledMap.values());
    }

    // 合并到全局 maskA（各房间格子不重叠，直接覆盖）
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (finalA[r][c] !== 0) globalMaskA[r][c] = finalA[r][c];
      }
    }
  }

  allFurnitureIndex.sort((a, b) => a.rank - b.rank);

  return { newMaskA: globalMaskA, furnitureIndex: allFurnitureIndex };
}
