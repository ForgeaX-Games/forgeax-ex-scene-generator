/**
 * mask_edge: 掩码边缘提取
 * 输入：inputGrid (grid) — 二维整数网格
 * 输出：outputGrid (grid) — 仅保留每行最左/最右、每列最上/最下的非零值，其余置0
 */

/**
 * 收集每行最左/最右非零格、每列最上/最下非零格的坐标集合。
 * 四类边缘取并集，重叠格只保留一份。
 */
function collectEdgeCells(grid: number[][]): Set<string> {
  const rows = grid.length;
  const cols = grid[0].length;
  const edgeKeys = new Set<string>();

  // 每行：最左非零 + 最右非零
  for (let r = 0; r < rows; r++) {
    let leftCol = -1;
    let rightCol = -1;
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) {
        if (leftCol === -1) leftCol = c;
        rightCol = c;
      }
    }
    if (leftCol !== -1) edgeKeys.add(`${r},${leftCol}`);
    if (rightCol !== -1 && rightCol !== leftCol) edgeKeys.add(`${r},${rightCol}`);
  }

  // 每列：最上非零 + 最下非零
  for (let c = 0; c < cols; c++) {
    let topRow = -1;
    let bottomRow = -1;
    for (let r = 0; r < rows; r++) {
      if (grid[r][c] !== 0) {
        if (topRow === -1) topRow = r;
        bottomRow = r;
      }
    }
    if (topRow !== -1) edgeKeys.add(`${topRow},${c}`);
    if (bottomRow !== -1 && bottomRow !== topRow) edgeKeys.add(`${bottomRow},${c}`);
  }

  return edgeKeys;
}

export function maskEdge(input: Record<string, unknown>): Record<string, unknown> {
  const inputGrid = input.inputGrid as number[][] | undefined;

  if (!inputGrid || inputGrid.length === 0 || inputGrid[0].length === 0) {
    return { error: "inputGrid is required and must be non-empty" };
  }

  const rows = inputGrid.length;
  const cols = inputGrid[0].length;

  const edgeKeys = collectEdgeCells(inputGrid);

  const outputGrid: number[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      edgeKeys.has(`${r},${c}`) ? inputGrid[r][c] : 0
    )
  );

  return { outputGrid };
}
