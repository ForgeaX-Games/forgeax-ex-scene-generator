/**
 * room_mask_init: 初始化房间家具布局掩码
 * 输入：roomGrid (grid) — 室内空间网格（1=可用格，0=其他）
 *       doorGrid  (grid) — 门位置网格（1=门格，0=其他），尺寸须与 roomGrid 相同
 * 输出：maskA (grid) — 家具实体占用掩码（初始全零，将来由放置算法写入）
 *       maskB (grid) — 家具过道占用掩码（门格的上下左右相邻格标为1）
 */

type Grid = number[][];

/**
 * 对门格的四邻格在 mask_b 中标为1，模拟门口通道预留区。
 * 与 init_result.py 逻辑完全一致：门格自身不写入 maskB，只写其相邻格。
 */
function buildMaskB(doorGrid: Grid, rows: number, cols: number): Grid {
  const maskB: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (doorGrid[r][c] === 0) continue;
      for (const [dr, dc] of dirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
          maskB[nr][nc] = 1;
        }
      }
    }
  }

  return maskB;
}

export function roomMaskInit(input: Record<string, unknown>): Record<string, unknown> {
  const roomGrid = input.roomGrid as Grid | undefined;
  const doorGrid = input.doorGrid as Grid | undefined;

  if (!roomGrid || !Array.isArray(roomGrid) || roomGrid.length === 0) {
    return { error: "roomGrid is required and must be a non-empty 2D array" };
  }
  if (!doorGrid || !Array.isArray(doorGrid) || doorGrid.length === 0) {
    return { error: "doorGrid is required and must be a non-empty 2D array" };
  }

  const rows = roomGrid.length;
  const cols = roomGrid[0].length;

  if (doorGrid.length !== rows || doorGrid[0].length !== cols) {
    return { error: `doorGrid size (${doorGrid.length}x${doorGrid[0].length}) must match roomGrid size (${rows}x${cols})` };
  }

  const maskA: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const maskB = buildMaskB(doorGrid, rows, cols);

  return { maskA, maskB };
}
