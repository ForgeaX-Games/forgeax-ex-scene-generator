/**
 * tessCairo: 开罗五边形镶嵌格
 *
 * 开罗五边形镶嵌（Cairo pentagonal tiling）是平面上最著名的全等五边形镶嵌之一，
 * 以埃及开罗街道铺装而得名。所有格子是完全相同的不规则五边形。
 *
 * 构造方法（交替对角线分块法）：
 *   将平面用正方形网格（边长 u）分割，再在每个格子内画一条对角线，
 *   相邻格子用交替方向的对角线（"/" 和 "\"）。
 *   由此产生 4 种三角形类型（偶行偶列、偶行奇列、奇行偶列、奇行奇列）。
 *
 *   在 2×2 超格内，4 个三角形两两合并构成一个五边形：
 *     五边形 = 偶奇格的上三角 + 奇偶格的左三角（相邻）
 *   共形成 4 个五边形（每个五边形由 2 个不同格的三角形组成），
 *   所有五边形通过旋转/反射全等。
 *
 * 实现方式：
 *   对每个像素，先判断所在格子和对角线分区（哪种三角形），
 *   再通过一个固定的"合并规则"映射到五边形 ID。
 */

/**
 * 给定像素坐标，返回其所属的开罗五边形唯一键。
 *
 * 规则（u = 格子边长）：
 *  1. 格子坐标 (cx, cy) = (floor(x/u), floor(y/u))
 *  2. 奇偶性 p = (cx + cy) % 2
 *  3. 局部归一化坐标 (fx, fy) ∈ [0,1)
 *  4. p=0（偶格）：用 "/" 对角线（fy = 1-fx）分割
 *       tri=0: 上三角（fx+fy < 1）
 *       tri=1: 下三角（fx+fy ≥ 1）
 *  5. p=1（奇格）：用 "\" 对角线（fy = fx）分割
 *       tri=0: 左三角（fx > fy）→ 上右三角
 *       tri=1: 右三角（fx ≤ fy）→ 下左三角
 *  6. 合并规则（五边形 = 2 个三角形）：
 *       A 型五边形：偶格上三角(cx,cy) + 奇格左三角(cx+1,cy)
 *       B 型五边形：偶格下三角(cx,cy) + 奇格右三角(cx-1,cy)
 *       → 归一化为五边形的"基准格"坐标
 */
function pixelToCairoKey(px: number, py: number, u: number): string {
  const cx = Math.floor(px / u);
  const cy = Math.floor(py / u);
  const fx = (px - cx * u) / u; // [0,1)
  const fy = (py - cy * u) / u; // [0,1)
  const p = (cx + cy) & 1;

  if (p === 0) {
    // 偶格："/" 对角线，fx + fy = 1
    if (fx + fy < 1) {
      // 上三角（tri=0）→ 与右侧奇格(cx+1,cy)的左三角合并
      // 五边形锚定在偶格 (cx, cy)，类型 A
      return `A,${cx},${cy}`;
    } else {
      // 下三角（tri=1）→ 与左侧奇格(cx-1,cy)的右三角合并
      // 五边形锚定在偶格 (cx, cy)，类型 B
      return `B,${cx},${cy}`;
    }
  } else {
    // 奇格："\" 对角线，fx = fy
    if (fx > fy) {
      // 左（上右）三角（tri=0）→ 归属于左侧偶格(cx-1,cy)的 A 型五边形
      return `A,${cx - 1},${cy}`;
    } else {
      // 右（下左）三角（tri=1）→ 归属于右侧偶格(cx+1,cy)的 B 型五边形
      return `B,${cx + 1},${cy}`;
    }
  }
}

function buildCairoGrid(w: number, h: number, u: number): number[][] {
  const cellMap = new Map<string, number>();
  let nextId = 1;
  const grid: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const key = pixelToCairoKey(x, y, u);
      if (!cellMap.has(key)) cellMap.set(key, nextId++);
      grid[y][x] = cellMap.get(key)!;
    }
  }
  return grid;
}

export function tessCairo(
  input: Record<string, unknown>
): Record<string, unknown> {
  const w = typeof input.width === "number" ? Math.max(4, Math.round(input.width)) : 80;
  const h = typeof input.height === "number" ? Math.max(4, Math.round(input.height)) : 80;
  const cellSize = typeof input.cellSize === "number" ? Math.max(2, input.cellSize) : 10;

  const regionGrid = buildCairoGrid(w, h, cellSize);
  return { regionGrid };
}
