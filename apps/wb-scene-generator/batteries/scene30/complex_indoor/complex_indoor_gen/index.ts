/**
 * complex_indoor_gen: 复杂室内布局生成器
 * 通过迭代房间增长（走廊连接/直接拼接）+ 轮廓复杂度控制 + 连通性校验，
 * 生成类似射击游戏的多房间室内平面布局。
 * 输入：width, height, targetRoomCount, corridorProb, seed 等
 * 输出：outputGrid (0=墙,1=房间,2=走廊,3=门), nameList, roomList
 */

import { generateLayout, LayoutConfig } from "./algorithm";

export function complexIndoorGen(
  input: Record<string, unknown>
): Record<string, unknown> {
  const width =
    typeof input.width === "number" ? Math.max(60, input.width) : 200;
  const height =
    typeof input.height === "number" ? Math.max(60, input.height) : 150;
  const targetRoomCount =
    typeof input.targetRoomCount === "number"
      ? Math.max(3, input.targetRoomCount)
      : 25;
  const initRoomMinSize =
    typeof input.initRoomMinSize === "number"
      ? Math.max(4, input.initRoomMinSize)
      : 10;
  const initRoomMaxSize =
    typeof input.initRoomMaxSize === "number"
      ? Math.max(initRoomMinSize, input.initRoomMaxSize)
      : 18;
  const corridorProb =
    typeof input.corridorProb === "number"
      ? Math.max(0, Math.min(1, input.corridorProb))
      : 0.4;
  const corridorWidthMin =
    typeof input.corridorWidthMin === "number"
      ? Math.max(2, input.corridorWidthMin)
      : 2;
  const corridorWidthMax =
    typeof input.corridorWidthMax === "number"
      ? Math.max(corridorWidthMin, input.corridorWidthMax)
      : 6;
  const corridorLenMin =
    typeof input.corridorLenMin === "number"
      ? Math.max(2, input.corridorLenMin)
      : 3;
  const corridorLenMax =
    typeof input.corridorLenMax === "number"
      ? Math.max(corridorLenMin, input.corridorLenMax)
      : 12;
  const doorWidthMin =
    typeof input.doorWidthMin === "number"
      ? Math.max(2, input.doorWidthMin)
      : 2;
  const roomMinDim =
    typeof input.roomMinDim === "number" ? Math.max(3, input.roomMinDim) : 4;
  const silhouetteRMax =
    typeof input.silhouetteRMax === "number"
      ? Math.max(3, input.silhouetteRMax)
      : 6.0;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;

  const cfg: LayoutConfig = {
    width,
    height,
    targetRoomCount,
    initRoomMinSize,
    initRoomMaxSize,
    corridorProb,
    roomAreaRatioMin: 0.3,
    roomAreaRatioMax: 2.5,
    rareLargeRoomProb: 0.08,
    rareLargeRoomRatioMax: 5.0,
    corridorWidthMin,
    corridorWidthMax,
    corridorLenMin,
    corridorLenMax,
    doorWidthMin,
    maxAttemptsPerRoom: 40,
    silhouetteRMax,
    roomMinDim,
  };

  const result = generateLayout(cfg, seed);

  const nameList = [
    { id: 0, name: "墙壁" },
    { id: 1, name: "房间" },
    { id: 2, name: "走廊" },
    { id: 3, name: "门" },
  ];

  return {
    outputGrid: result.grid,
    nameList,
    roomList: result.rooms.map((r) => ({
      id: r.id,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      area: r.area,
      isCorridor: r.isCorridor,
      parentId: r.parentId,
    })),
  };
}
