/**
 * complex_indoor_grow
 * Iteratively grows rooms via direct attachment (80%) or corridor linking (20%).
 * Supports irregular (L-shaped) rooms and contour complexity control.
 */

import { growRooms, makeLCG, GrowConfig, RoomEntry } from "./algorithm";

export function complexIndoorGrow(
  input: Record<string, unknown>
): Record<string, unknown> {
  const inputGrid = input.inputGrid as number[][] | undefined;
  if (!inputGrid || !Array.isArray(inputGrid) || inputGrid.length === 0) {
    return { error: "inputGrid is required" };
  }

  const roomListRaw = input.roomList;
  let roomList: RoomEntry[] = [];
  if (Array.isArray(roomListRaw)) {
    roomList = roomListRaw.map((r: any) => ({
      id: typeof r.id === "number" ? r.id : 0,
      rects: Array.isArray(r.rects) ? r.rects : [],
      innerArea: typeof r.innerArea === "number" ? r.innerArea : 0,
      parentId: typeof r.parentId === "number" ? r.parentId : -1,
      isCorridor: !!r.isCorridor,
    }));
  }

  const nextRoomIdIn = typeof input.nextRoomId === "number" ? input.nextRoomId : 3;

  const targetRoomCount = typeof input.targetRoomCount === "number" ? Math.max(2, input.targetRoomCount) : 20;
  const corridorProb = typeof input.corridorProb === "number" ? Math.max(0, Math.min(1, input.corridorProb)) : 0.2;
  const areaRatioMin = typeof input.areaRatioMin === "number" ? Math.max(0.1, input.areaRatioMin) : 0.8;
  const areaRatioMax = typeof input.areaRatioMax === "number" ? Math.max(areaRatioMin, input.areaRatioMax) : 2.0;
  const rareLargeProb = typeof input.rareLargeProb === "number" ? Math.max(0, Math.min(1, input.rareLargeProb)) : 0.05;
  const rareLargeMax = typeof input.rareLargeMax === "number" ? Math.max(areaRatioMax, input.rareLargeMax) : 4.0;
  const corridorWidthMin = typeof input.corridorWidthMin === "number" ? Math.max(2, input.corridorWidthMin) : 2;
  const corridorWidthMax = typeof input.corridorWidthMax === "number" ? Math.max(corridorWidthMin, input.corridorWidthMax) : 4;
  const corridorLenMin = typeof input.corridorLenMin === "number" ? Math.max(2, input.corridorLenMin) : 3;
  const corridorLenMax = typeof input.corridorLenMax === "number" ? Math.max(corridorLenMin, input.corridorLenMax) : 10;
  const irregularProb = typeof input.irregularProb === "number" ? Math.max(0, Math.min(1, input.irregularProb)) : 0.3;
  const silhouetteRMax = typeof input.silhouetteRMax === "number" ? Math.max(3, input.silhouetteRMax) : 6.0;
  const maxAttempts = typeof input.maxAttempts === "number" ? Math.max(5, input.maxAttempts) : 40;
  const roomMinDim = typeof input.roomMinDim === "number" ? Math.max(3, input.roomMinDim) : 4;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;

  const grid = inputGrid.map(row => [...row]);

  const rng = makeLCG(seed);

  const cfg: GrowConfig = {
    targetRoomCount,
    corridorProb,
    areaRatioMin,
    areaRatioMax,
    rareLargeProb,
    rareLargeMax,
    corridorWidthMin,
    corridorWidthMax,
    corridorLenMin,
    corridorLenMax,
    irregularProb,
    silhouetteRMax,
    maxAttempts,
    roomMinDim,
  };

  const result = growRooms(grid, roomList, nextRoomIdIn, cfg, rng);

  return {
    outputGrid: grid,
    roomList: result.roomList,
    connectionList: result.connectionList,
    nextRoomId: result.nextRoomId,
  };
}
