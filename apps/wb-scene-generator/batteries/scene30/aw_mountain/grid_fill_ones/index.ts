/**
 * gridFillOnes: 将网格中所有非零格子置为 1，零格子保持 0
 * 输入：grid (grid) — 任意整数二维网格
 * 输出：outputGrid (grid) — 二值网格（非零→1，零→0）
 */

function fillOnes(grid: number[][]): number[][] {
  return grid.map(row => row.map(() => 1));
}

export function gridFillOnes(input: Record<string, unknown>): Record<string, unknown> {
  const raw = input.grid;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { outputGrid: [], errorMessage: "grid 为空或格式不正确" };
  }

  // 兼容网格列表（取第一张）
  const firstRow = (raw as unknown[])[0];
  let grid: number[][];
  if (Array.isArray(firstRow) && typeof (firstRow as unknown[])[0] === "number") {
    grid = raw as number[][];
  } else if (Array.isArray(firstRow) && Array.isArray((firstRow as unknown[])[0])) {
    grid = (raw as number[][][])[0];
  } else {
    return { outputGrid: [], errorMessage: `grid 格式无法识别，首行类型：${typeof firstRow}` };
  }

  return { outputGrid: fillOnes(grid) };
}
