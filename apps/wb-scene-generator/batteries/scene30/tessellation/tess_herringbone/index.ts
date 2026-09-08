/**
 * tessHerringbone: 人字形砖块镶嵌格
 *
 * 将平面分割为人字形（herringbone）排列的矩形砖块，所有砖块形状完全相同（2:1 矩形）。
 *
 * 超格结构（4u × 4u，u = brickH）：
 *   ┌─────────┬────┬────┐
 *   │ H  H  H │ V  │ V  │  ← 左上4格：2块水平砖；右上4格：2块垂直砖
 *   │ H  H  H │ V  │ V  │
 *   ├────┬────┼─────────┤
 *   │ V  │ V  │ H  H  H │  ← 左下4格：2块垂直砖；右下4格：2块水平砖
 *   │ V  │ V  │ H  H  H │
 *   └────┴────┴─────────┘
 *
 * H = 水平砖（2u 宽 × u 高），V = 垂直砖（u 宽 × 2u 高）
 * 旋转后形状相同（congruent），满足"每块形状相同"的镶嵌条件。
 */

function buildHerringboneGrid(w: number, h: number, u: number): number[][] {
  const superCell = u * 4; // 超格边长

  const cellMap = new Map<string, number>();
  let nextId = 1;
  const grid: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.floor(x / superCell);
      const sy = Math.floor(y / superCell);
      const lx = x - sx * superCell; // [0, 4u)
      const ly = y - sy * superCell; // [0, 4u)

      // 四象限：qx 0=左, 1=右; qy 0=上, 1=下
      const qx = lx < 2 * u ? 0 : 1;
      const qy = ly < 2 * u ? 0 : 1;
      // 象限内局部坐标
      const lxq = lx - qx * 2 * u; // [0, 2u)
      const lyq = ly - qy * 2 * u; // [0, 2u)

      let key: string;
      if ((qx + qy) % 2 === 0) {
        // 对角象限（左上 + 右下）：水平砖（2u 宽 × u 高）
        const brickRow = Math.floor(lyq / u); // 0 或 1
        key = `H,${sx},${sy},${qx},${qy},${brickRow}`;
      } else {
        // 反对角象限（右上 + 左下）：垂直砖（u 宽 × 2u 高）
        const brickCol = Math.floor(lxq / u); // 0 或 1
        key = `V,${sx},${sy},${qx},${qy},${brickCol}`;
      }

      if (!cellMap.has(key)) cellMap.set(key, nextId++);
      grid[y][x] = cellMap.get(key)!;
    }
  }
  return grid;
}

export function tessHerringbone(
  input: Record<string, unknown>
): Record<string, unknown> {
  const w = typeof input.width === "number" ? Math.max(4, Math.round(input.width)) : 80;
  const h = typeof input.height === "number" ? Math.max(4, Math.round(input.height)) : 80;
  const brickSize = typeof input.brickSize === "number" ? Math.max(2, Math.round(input.brickSize)) : 6;

  const regionGrid = buildHerringboneGrid(w, h, brickSize);
  return { regionGrid };
}
