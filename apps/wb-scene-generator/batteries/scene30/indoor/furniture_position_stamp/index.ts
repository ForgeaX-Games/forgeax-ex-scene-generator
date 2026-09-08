/**
 * furniture_position_stamp: 将家具 mask 按语义位置（0-8）盖印到室内空间中
 *
 * position 定义（基于室内可用区，即 roomGrid 中值为 1 的格子的包围盒）：
 *   0 = 居中         家具本体中心 对齐 室内中心
 *   1 = 贴上中       家具本体最上行 贴上墙，本体中心列 对齐 室内中心列
 *   2 = 贴右中       家具本体最右列 贴右墙，本体中心行 对齐 室内中心行
 *   3 = 贴下中       家具本体最下行 贴下墙，本体中心列 对齐 室内中心列
 *   4 = 贴左中       家具本体最左列 贴左墙，本体中心行 对齐 室内中心行
 *   5 = 左上角       家具本体最上行 贴上墙，最左列 贴左墙
 *   6 = 右上角       家具本体最上行 贴上墙，最右列 贴右墙
 *   7 = 右下角       家具本体最下行 贴下墙，最右列 贴右墙
 *   8 = 左下角       家具本体最下行 贴下墙，最左列 贴左墙
 *
 * 中心取整：非整数时直接截断（Math.floor）。
 *
 * 输入：furnitureMask      (grid)   — 家具 mask（1=本体，>1=子组件，0=过道）
 *       furnitureName      (string) — 家具名称
 *       position           (number) — 位置编号 0-8
 *       roomGrid           (grid)   — 室内空间网格（1=可用，0=墙）
 *       maskA              (grid)   — 家具实体占用网格
 *       maskB              (grid)   — 过道预留网格
 *       oldFurnitureIndex  (array)  — 旧家具编号列表（无时传 []）
 * 输出：newMaskA           (grid)   — 更新后的家具实体网格
 *       newMaskB           (grid)   — 更新后的过道预留网格
 *       furnitureIndex     (array)  — 所有家具编号列表（旧+新）
 *       placementFailed    (bool)   — 碰撞检测不通过时为 true
 *       failReason         (string) — 失败原因，成功时为空字符串
 */

type Grid = number[][];
type FurnitureDirection = "top" | "right" | "bottom" | "left" | "square" | "h" | "v";

interface FurnitureIndexEntry {
  rank: number;
  name: string;
  isGroup: boolean;
  direction?: FurnitureDirection;
}

/** 根据 position(0-8) 推断家具朝向 */
function positionToDirection(position: number): FurnitureDirection {
  switch (position) {
    case 1: return "top";
    case 2: return "right";
    case 3: return "bottom";
    case 4: return "left";
    case 5: return "top";
    case 6: return "top";
    case 7: return "bottom";
    case 8: return "bottom";
    default: return "square";
  }
}

/** 室内可用区包围盒（roomGrid 中所有值为 1 的格子的行列范围） */
interface RoomBounds {
  minR: number; maxR: number;
  minC: number; maxC: number;
}

/** 家具本体（mask 值 >= 1）的行列范围（相对于 mask 左上角的偏移） */
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

/**
 * 根据 position(0-8) 计算放置锚点 (anchorR, anchorC)。
 * 锚点是 mask[0][0] 在 roomGrid 中的坐标。
 */
function computeAnchor(
  position: number,
  room: RoomBounds,
  body: BodyBounds
): [number, number] {
  // 室内中心（截断取整）
  const roomCenterR = Math.floor((room.minR + room.maxR) / 2);
  const roomCenterC = Math.floor((room.minC + room.maxC) / 2);

  // 家具本体中心相对 mask 左上角的偏移（截断取整）
  const bodyCenterDr = Math.floor((body.minDr + body.maxDr) / 2);
  const bodyCenterDc = Math.floor((body.minDc + body.maxDc) / 2);

  // 各轴锚点：anchorR = 目标行 - 家具本体对应行偏移
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

export function furniturePositionStamp(input: Record<string, unknown>): Record<string, unknown> {
  const furnitureMask = input.furnitureMask as Grid | undefined;
  const furnitureName = typeof input.furnitureName === "string" ? input.furnitureName : "未命名家具";
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

  const maxOldRank = oldFurnitureIndex.reduce((max, e) => Math.max(max, e.rank), 0);

  // 收集 mask 中所有唯一正整数值（每个值代表一个独立实例单元），按值排序
  const unitValues = new Set<number>();
  for (const row of furnitureMask) {
    for (const v of row) {
      if (v >= 1) unitValues.add(v);
    }
  }
  const sortedUnits = Array.from(unitValues).sort((a, b) => a - b);

  // 每个唯一值分配独立 effectiveRank（从 maxOldRank+1 起连续）
  const unitToRank = new Map<number, number>();
  sortedUnits.forEach((unitVal, idx) => {
    unitToRank.set(unitVal, maxOldRank + 1 + idx);
  });

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
        const rank = unitToRank.get(v);
        if (rank !== undefined) outMaskA[gr][gc] = rank;
      } else {
        if (roomGrid[gr][gc] === 1) {
          outMaskB[gr][gc] = 1;
        }
      }
    }
  }

  // 每个实例生成独立条目，附带 direction
  const direction = positionToDirection(position);
  const newEntries: FurnitureIndexEntry[] = sortedUnits.map(unitVal => ({
    rank: unitToRank.get(unitVal)!,
    name: furnitureName,
    isGroup: false,
    direction,
  }));

  const furnitureIndex: FurnitureIndexEntry[] = [
    ...oldFurnitureIndex,
    ...newEntries,
  ];

  return {
    newMaskA: outMaskA,
    newMaskB: outMaskB,
    furnitureIndex,
    placementFailed: false,
    failReason: "",
  };
}
