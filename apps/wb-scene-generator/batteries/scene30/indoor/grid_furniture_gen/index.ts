/**
 * grid_furniture_gen: 生成规律化网格家具 mask（居中型，周边一圈 0）
 * 输入：unitW (number) — 单个本体列数（宽）
 *       unitH (number) — 单个本体行数（高）
 *       colGap (number) — 列间距格子数
 *       rowGap (number) — 行间距格子数
 *       cols   (number) — 列数量
 *       rows   (number) — 行数量
 * 输出：mask (grid) — 生成的家具 mask 二维网格
 */

type Grid = number[][];

function buildMask(
  unitW: number, unitH: number,
  colGap: number, rowGap: number,
  cols: number, rows: number
): Grid {
  const innerRows = rows * unitH + (rows - 1) * rowGap;
  const innerCols = cols * unitW + (cols - 1) * colGap;

  const inner: Grid = Array.from({ length: innerRows }, () =>
    new Array(innerCols).fill(0)
  );

  for (let ri = 0; ri < rows; ri++) {
    for (let ci = 0; ci < cols; ci++) {
      const rStart = ri * (unitH + rowGap);
      const cStart = ci * (unitW + colGap);
      for (let r = 0; r < unitH; r++) {
        for (let c = 0; c < unitW; c++) {
          inner[rStart + r][cStart + c] = 1;
        }
      }
    }
  }

  // 居中家具规范：四周补一圈 0
  const totalCols = innerCols + 2;
  const emptyRow = new Array(totalCols).fill(0);
  const mask: Grid = [emptyRow.slice()];
  for (const row of inner) {
    mask.push([0, ...row, 0]);
  }
  mask.push(emptyRow.slice());

  return mask;
}

export function gridFurnitureGen(input: Record<string, unknown>): Record<string, unknown> {
  const unitW  = typeof input.unitW  === "number" ? Math.max(1, Math.floor(input.unitW))  : 1;
  const unitH  = typeof input.unitH  === "number" ? Math.max(1, Math.floor(input.unitH))  : 1;
  const colGap = typeof input.colGap === "number" ? Math.max(0, Math.floor(input.colGap)) : 1;
  const rowGap = typeof input.rowGap === "number" ? Math.max(0, Math.floor(input.rowGap)) : 1;
  const cols   = typeof input.cols   === "number" ? Math.max(1, Math.floor(input.cols))   : 1;
  const rows   = typeof input.rows   === "number" ? Math.max(1, Math.floor(input.rows))   : 1;

  const mask = buildMask(unitW, unitH, colGap, rowGap, cols, rows);

  return { mask };
}
