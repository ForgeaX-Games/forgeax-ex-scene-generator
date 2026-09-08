/**
 * furniture_group_position_stamp: 将家具组 mask 按语义位置（0-8）盖印到室内空间中
 *
 * position 定义（基于室内可用区包围盒）：
 *   0 = 居中     家具本体中心 对齐 室内中心
 *   1 = 贴上中   家具本体最上行 贴上墙，本体中心列 对齐 室内中心列
 *   2 = 贴右中   家具本体最右列 贴右墙，本体中心行 对齐 室内中心行
 *   3 = 贴下中   家具本体最下行 贴下墙，本体中心列 对齐 室内中心列
 *   4 = 贴左中   家具本体最左列 贴左墙，本体中心行 对齐 室内中心行
 *   5 = 左上角   家具本体最上行 贴上墙，最左列 贴左墙
 *   6 = 右上角   家具本体最上行 贴上墙，最右列 贴右墙
 *   7 = 右下角   家具本体最下行 贴下墙，最右列 贴右墙
 *   8 = 左下角   家具本体最下行 贴下墙，最左列 贴左墙
 *
 * 编号规则：
 *   n = 旧编号列表最大 rank
 *   mask 值 v >= 1 → maskA 写入 n + v
 *   groupIndex 中每条 {rank: r} → 输出 {rank: n + r}
 *
 * 输入：furnitureMask      (grid)   — 家具组 mask（非零值=组内子组件编号，0=过道）
 *       groupIndex         (array)  — 家具组编号列表，每项 {rank(组内相对), name, isGroup}
 *       position           (number) — 位置编号 0-8
 *       roomGrid           (grid)   — 室内空间网格（1=可用，0=墙）
 *       maskA              (grid)   — 家具实体占用网格
 *       maskB              (grid)   — 过道预留网格
 *       oldFurnitureIndex  (array)  — 旧家具编号列表（无时传 []）
 * 输出：newMaskA           (grid)   — 更新后的家具实体网格
 *       newMaskB           (grid)   — 更新后的过道预留网格
 *       furnitureIndex     (array)  — 所有家具编号列表（旧+新，新条目 rank = n + 组内 rank）
 *       placementFailed    (bool)   — 碰撞检测不通过时为 true
 *       failReason         (string) — 失败原因，成功时为空字符串
 */

type Grid = number[][];

interface FurnitureIndexEntry {
  rank: number;
  name: string;
  isGroup: boolean;
}

interface RoomBounds {
  minR: number; maxR: number;
  minC: number; maxC: number;
}

interface BodyBounds {
  minDr: number; maxDr: number;
  minDc: number; maxDc: number;
}

function getRoomBounds(roomGrid: Grid): RoomBounds | null {
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (let r = 0; r < roomGrid.length; r++) {
    for (let c = 0; c < (roomGrid[r]?.length ?? 0); c++) {
      if (roomGrid[r][c] === 1) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  if (minR === Infinity) return null;
  return { minR, maxR, minC, maxC };
}

function getBodyBounds(mask: Grid): BodyBounds | null {
  let minDr = Infinity, maxDr = -Infinity, minDc = Infinity, maxDc = -Infinity;
  for (let dr = 0; dr < mask.length; dr++) {
    for (let dc = 0; dc < (mask[dr]?.length ?? 0); dc++) {
      if (mask[dr][dc] >= 1) {
        if (dr < minDr) minDr = dr;
        if (dr > maxDr) maxDr = dr;
        if (dc < minDc) minDc = dc;
        if (dc > maxDc) maxDc = dc;
      }
    }
  }
  if (minDr === Infinity) return null;
  return { minDr, maxDr, minDc, maxDc };
}

function computeAnchor(
  position: number,
  room: RoomBounds,
  body: BodyBounds
): [number, number] {
  const roomCenterR = Math.floor((room.minR + room.maxR) / 2);
  const roomCenterC = Math.floor((room.minC + room.maxC) / 2);
  const bodyCenterDr = Math.floor((body.minDr + body.maxDr) / 2);
  const bodyCenterDc = Math.floor((body.minDc + body.maxDc) / 2);

  let anchorR: number;
  let anchorC: number;

  switch (position) {
    case 0: // 居中
      anchorR = roomCenterR - bodyCenterDr;
      anchorC = roomCenterC - bodyCenterDc;
      break;
    case 1: // 贴上中
      anchorR = room.minR - body.minDr;
      anchorC = roomCenterC - bodyCenterDc;
      break;
    case 2: // 贴右中
      anchorR = roomCenterR - bodyCenterDr;
      anchorC = room.maxC - body.maxDc;
      break;
    case 3: // 贴下中
      anchorR = room.maxR - body.maxDr;
      anchorC = roomCenterC - bodyCenterDc;
      break;
    case 4: // 贴左中
      anchorR = roomCenterR - bodyCenterDr;
      anchorC = room.minC - body.minDc;
      break;
    case 5: // 左上角
      anchorR = room.minR - body.minDr;
      anchorC = room.minC - body.minDc;
      break;
    case 6: // 右上角
      anchorR = room.minR - body.minDr;
      anchorC = room.maxC - body.maxDc;
      break;
    case 7: // 右下角
      anchorR = room.maxR - body.maxDr;
      anchorC = room.maxC - body.maxDc;
      break;
    case 8: // 左下角
      anchorR = room.maxR - body.maxDr;
      anchorC = room.minC - body.minDc;
      break;
    default:
      anchorR = roomCenterR - bodyCenterDr;
      anchorC = roomCenterC - bodyCenterDc;
  }

  return [anchorR, anchorC];
}

function checkCollision(
  furnitureMask: Grid,
  anchorR: number, anchorC: number,
  roomGrid: Grid, maskA: Grid, maskB: Grid,
  roomRows: number, roomCols: number
): string | null {
  for (let dr = 0; dr < furnitureMask.length; dr++) {
    const maskRow = furnitureMask[dr];
    if (!maskRow) continue;
    for (let dc = 0; dc < maskRow.length; dc++) {
      const v = maskRow[dc];
      const gr = anchorR + dr;
      const gc = anchorC + dc;

      if (v >= 1) {
        if (gr < 0 || gr >= roomRows || gc < 0 || gc >= roomCols) {
          return `本体格 (${gr},${gc}) 超出网格范围`;
        }
        if (roomGrid[gr][gc] !== 1) {
          return `本体格 (${gr},${gc}) 不是有效房间格`;
        }
        if (maskA[gr][gc] !== 0) {
          return `本体格 (${gr},${gc}) 与已有家具实体重叠（maskA=${maskA[gr][gc]}）`;
        }
        if (maskB[gr][gc] !== 0) {
          return `本体格 (${gr},${gc}) 与已有过道重叠（maskB=${maskB[gr][gc]}）`;
        }
      } else {
        if (gr >= 0 && gr < roomRows && gc >= 0 && gc < roomCols) {
          if (roomGrid[gr][gc] === 1 && maskA[gr][gc] !== 0) {
            return `过道格 (${gr},${gc}) 压到已有家具实体（maskA=${maskA[gr][gc]}）`;
          }
        }
      }
    }
  }
  return null;
}

function cloneGrid(grid: Grid): Grid {
  return grid.map(row => [...row]);
}

export function furnitureGroupPositionStamp(input: Record<string, unknown>): Record<string, unknown> {
  const furnitureMask = input.furnitureMask as Grid | undefined;
  const groupIndex = Array.isArray(input.groupIndex)
    ? (input.groupIndex as FurnitureIndexEntry[])
    : [];
  const position = typeof input.position === "number" ? Math.floor(input.position) : 0;
  const roomGrid = input.roomGrid as Grid | undefined;
  const maskA = input.maskA as Grid | undefined;
  const maskB = input.maskB as Grid | undefined;
  const oldFurnitureIndex = Array.isArray(input.oldFurnitureIndex)
    ? (input.oldFurnitureIndex as FurnitureIndexEntry[])
    : [];

  if (!furnitureMask || !Array.isArray(furnitureMask) || furnitureMask.length === 0) {
    return { error: "furnitureMask is required and must be a non-empty 2D array" };
  }
  if (!roomGrid || !Array.isArray(roomGrid) || roomGrid.length === 0) {
    return { error: "roomGrid is required and must be a non-empty 2D array" };
  }
  if (!maskA || !Array.isArray(maskA)) {
    return { error: "maskA is required" };
  }
  if (!maskB || !Array.isArray(maskB)) {
    return { error: "maskB is required" };
  }
  if (groupIndex.length === 0) {
    return { error: "groupIndex is required and must be a non-empty array" };
  }
  if (position < 0 || position > 8) {
    return { error: `position 必须在 0-8 之间，当前值为 ${position}` };
  }

  const roomRows = roomGrid.length;
  const roomCols = roomGrid[0]?.length ?? 0;

  const roomBounds = getRoomBounds(roomGrid);
  if (!roomBounds) {
    return { error: "roomGrid has no valid (value=1) cells" };
  }

  const bodyBounds = getBodyBounds(furnitureMask);
  if (!bodyBounds) {
    return { error: "furnitureMask has no body cells (value >= 1)" };
  }

  const [anchorR, anchorC] = computeAnchor(position, roomBounds, bodyBounds);

  const collisionReason = checkCollision(
    furnitureMask, anchorR, anchorC,
    roomGrid, maskA, maskB,
    roomRows, roomCols
  );
  if (collisionReason !== null) {
    return {
      newMaskA: maskA,
      newMaskB: maskB,
      furnitureIndex: oldFurnitureIndex,
      placementFailed: true,
      failReason: collisionReason,
    };
  }

  // n = 旧列表最大 rank，mask 值 v → 写入 n + v
  const n = oldFurnitureIndex.reduce((max, e) => Math.max(max, e.rank), 0);

  const outMaskA = cloneGrid(maskA);
  const outMaskB = cloneGrid(maskB);

  for (let dr = 0; dr < furnitureMask.length; dr++) {
    const maskRow = furnitureMask[dr];
    if (!maskRow) continue;
    for (let dc = 0; dc < maskRow.length; dc++) {
      const v = maskRow[dc];
      const gr = anchorR + dr;
      const gc = anchorC + dc;

      if (gr < 0 || gr >= roomRows || gc < 0 || gc >= roomCols) continue;

      if (v >= 1) {
        outMaskA[gr][gc] = n + v;
      } else {
        if (roomGrid[gr][gc] === 1) {
          outMaskB[gr][gc] = 1;
        }
      }
    }
  }

  // 输出编号列表：旧条目保留，家具组各条目 rank 平移 +n
  const newEntries: FurnitureIndexEntry[] = groupIndex.map(entry => ({
    rank: n + entry.rank,
    name: entry.name,
    isGroup: entry.isGroup,
  }));

  const furnitureIndex: FurnitureIndexEntry[] = [...oldFurnitureIndex, ...newEntries];

  return {
    newMaskA: outMaskA,
    newMaskB: outMaskB,
    furnitureIndex,
    placementFailed: false,
    failReason: "",
  };
}
