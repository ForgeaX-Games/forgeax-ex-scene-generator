/**
 * furniture_stamp: 将给定 mask 的家具按坐标直接盖印到室内空间中
 *
 * 坐标约定：
 *   - 先找 roomGrid 中值不为 0 的格子的最小行列（室内可用区的左上角 origin）
 *   - 再找家具 mask 中值不为 0 的格子的最小行列偏移（家具有效区的左上角 maskOrigin）
 *   - 最终放置锚点 = origin + (y, x) - maskOrigin
 *   即：家具有效区的左上角落在室内可用区左上角偏移 (y 行, x 列) 处
 *
 * 输入：furnitureMask      (grid)  — 家具 mask（1=本体，>1=子组件，0=过道）
 *       furnitureName      (string)— 家具名称
 *       x                  (number)— 相对室内可用区左上角的列偏移
 *       y                  (number)— 相对室内可用区左上角的行偏移
 *       roomGrid           (grid)  — 室内空间网格（1=可用，0=墙）
 *       maskA              (grid)  — 家具实体占用网格
 *       maskB              (grid)  — 过道预留网格
 *       oldFurnitureIndex  (array) — 旧家具编号列表（无旧家具时传 []）
 * 输出：newMaskA           (grid)  — 更新后的家具实体网格
 *       newMaskB           (grid)  — 更新后的过道预留网格
 *       furnitureIndex     (array) — 所有家具编号列表（旧+新）
 */

type Grid = number[][];

interface FurnitureIndexEntry {
  rank: number;
  name: string;
  isGroup: boolean;
}

/** 找二维网格中值不为 0 的格子的最小 (row, col) */
function findNonZeroOrigin(grid: Grid): [number, number] | null {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
      if (grid[r][c] !== 0) return [r, c];
    }
  }
  return null;
}

/** 深拷贝二维数组 */
function cloneGrid(grid: Grid): Grid {
  return grid.map(row => [...row]);
}

/**
 * 碰撞检测：在写入前验证放置是否合法。
 * 规则与 furniture_placer 一致：
 *   - 本体格（mask>=1）：必须在 roomGrid 内且为 1，且 maskA=0，且 maskB=0
 *   - 过道格（mask=0）：若在 roomGrid 范围内且为有效格，则 maskA 必须为 0（过道不能压实体）
 * 返回 null 表示合法，返回字符串为失败原因。
 */
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
        // 本体格：必须在界内、是有效房间格、且 maskA 和 maskB 均为空
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
        // 过道格：若在界内且是有效格，maskA 不能有实体
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

export function furnitureStamp(input: Record<string, unknown>): Record<string, unknown> {
  const furnitureMask = input.furnitureMask as Grid | undefined;
  const furnitureName = typeof input.furnitureName === "string" ? input.furnitureName : "未命名家具";
  const x = typeof input.x === "number" ? Math.floor(input.x) : 0;
  const y = typeof input.y === "number" ? Math.floor(input.y) : 0;
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

  const roomRows = roomGrid.length;
  const roomCols = roomGrid[0]?.length ?? 0;

  // 室内可用区左上角（roomGrid 中第一个非零格）
  const roomOrigin = findNonZeroOrigin(roomGrid);
  if (!roomOrigin) {
    return { error: "roomGrid has no valid (non-zero) cells" };
  }
  const [originR, originC] = roomOrigin;

  // 家具 mask 有效区左上角（mask 中第一个非零格）
  const maskOrigin = findNonZeroOrigin(furnitureMask);
  if (!maskOrigin) {
    return { error: "furnitureMask has no non-zero cells (empty furniture)" };
  }
  const [maskOriginR, maskOriginC] = maskOrigin;

  // 最终锚点：家具有效区左上角落在 (originR + y, originC + x) 处
  const anchorR = originR + y - maskOriginR;
  const anchorC = originC + x - maskOriginC;

  // 碰撞检测：不通过则原样返回，不修改任何状态
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

  // 计算新 rank（旧列表最大 rank + 1）
  const maxOldRank = oldFurnitureIndex.reduce((max, e) => Math.max(max, e.rank), 0);
  const effectiveRank = maxOldRank + 1;

  const outMaskA = cloneGrid(maskA);
  const outMaskB = cloneGrid(maskB);

  // 写入掩码
  for (let dr = 0; dr < furnitureMask.length; dr++) {
    const maskRow = furnitureMask[dr];
    if (!maskRow) continue;
    for (let dc = 0; dc < maskRow.length; dc++) {
      const v = maskRow[dc];
      const gr = anchorR + dr;
      const gc = anchorC + dc;

      if (gr < 0 || gr >= roomRows || gc < 0 || gc >= roomCols) continue;

      if (v === 1) {
        // 家具主体
        outMaskA[gr][gc] = effectiveRank;
      } else if (v > 1) {
        // 组合家具子组件
        outMaskA[gr][gc] = effectiveRank + 10;
      } else {
        // 过道格：仅当在有效房间格内才写 maskB
        if (roomGrid[gr][gc] === 1) {
          outMaskB[gr][gc] = 1;
        }
      }
    }
  }

  // 构建新家具条目（isGroup 固定为 true，如需区分可扩展）
  const newEntry: FurnitureIndexEntry = {
    rank: effectiveRank,
    name: furnitureName,
    isGroup: true,
  };

  const furnitureIndex: FurnitureIndexEntry[] = [...oldFurnitureIndex, newEntry];

  return {
    newMaskA: outMaskA,
    newMaskB: outMaskB,
    furnitureIndex,
    placementFailed: false,
    failReason: "",
  };
}
