/**
 * furniture_group_stamp: 将一个家具组 mask 按坐标盖印到室内空间中
 *
 * 与 furniture_stamp 的区别：
 *   - 不输入单个家具名称，而是输入整个"家具组编号列表"（含组内各子组件的相对编号和名称）
 *   - mask 中的非零值 v 直接对应家具组内第 v 号子组件
 *   - 写入 maskA 的值 = n + v（n = 旧编号列表最大 rank）
 *   - 输出编号列表中，家具组各条目的 rank = n + 组内相对 rank
 *
 * 坐标约定：
 *   - 先找 roomGrid 中值不为 0 的格子的最小行列（室内可用区的左上角 origin）
 *   - 再找家具 mask 中值不为 0 的格子的最小行列偏移（家具有效区的左上角 maskOrigin）
 *   - 最终放置锚点 = origin + (y, x) - maskOrigin
 *
 * 输入：furnitureMask      (grid)  — 家具组 mask（非零值=组内子组件编号，0=过道）
 *       groupIndex         (array) — 家具组编号列表，每项 {rank(组内相对), name, isGroup}
 *       x                  (number)— 相对室内可用区左上角的列偏移
 *       y                  (number)— 相对室内可用区左上角的行偏移
 *       roomGrid           (grid)  — 室内空间网格（1=可用，0=墙）
 *       maskA              (grid)  — 家具实体占用网格
 *       maskB              (grid)  — 过道预留网格
 *       oldFurnitureIndex  (array) — 旧家具编号列表（无时传 []）
 * 输出：newMaskA           (grid)  — 更新后的家具实体网格
 *       newMaskB           (grid)  — 更新后的过道预留网格
 *       furnitureIndex     (array) — 所有家具编号列表（旧+新，新条目 rank = n + 组内 rank）
 *       placementFailed    (bool)  — 碰撞检测不通过时为 true
 *       failReason         (string)— 失败原因，成功时为空字符串
 */

type Grid = number[][];

interface FurnitureIndexEntry {
  rank: number;
  name: string;
  isGroup: boolean;
}

function findNonZeroOrigin(grid: Grid): [number, number] | null {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
      if (grid[r][c] !== 0) return [r, c];
    }
  }
  return null;
}

function cloneGrid(grid: Grid): Grid {
  return grid.map(row => [...row]);
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

export function furnitureGroupStamp(input: Record<string, unknown>): Record<string, unknown> {
  const furnitureMask = input.furnitureMask as Grid | undefined;
  const groupIndex = Array.isArray(input.groupIndex)
    ? (input.groupIndex as FurnitureIndexEntry[])
    : [];
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
  if (groupIndex.length === 0) {
    return { error: "groupIndex is required and must be a non-empty array" };
  }

  const roomRows = roomGrid.length;
  const roomCols = roomGrid[0]?.length ?? 0;

  const roomOrigin = findNonZeroOrigin(roomGrid);
  if (!roomOrigin) {
    return { error: "roomGrid has no valid (non-zero) cells" };
  }
  const [originR, originC] = roomOrigin;

  const maskOrigin = findNonZeroOrigin(furnitureMask);
  if (!maskOrigin) {
    return { error: "furnitureMask has no non-zero cells (empty furniture group)" };
  }
  const [maskOriginR, maskOriginC] = maskOrigin;

  const anchorR = originR + y - maskOriginR;
  const anchorC = originC + x - maskOriginC;

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

  // n = 旧编号列表最大 rank，新家具组各子组件编号 = n + 组内相对 rank（即 mask 值 v）
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
        // mask 值 v 直接对应组内第 v 号子组件，写入 n + v
        outMaskA[gr][gc] = n + v;
      } else {
        // 过道格
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
