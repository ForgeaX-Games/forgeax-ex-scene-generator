/**
 * tessTriGrid: 三角形镶嵌格光栅化
 *
 * 将平面光栅化为等边三角形镶嵌网格，每个像素标注所属三角形单元 ID（1-based）。
 * 等边三角形自然形成"上三角 + 下三角"交替排列的行列结构。
 *
 * 算法：
 *   1. 计算行列格（col, row），每列宽 = cellSize / 2
 *   2. 利用局部归一化坐标的对角线斜率判断上/下三角
 *   3. 三角形编码为 (row, col)，通过 Map 分配连续 ID
 */

// ─── 像素 → 三角形唯一键 ─────────────────────────────────────────────────────

function pixelToTriKey(px: number, py: number, cellSize: number): string {
  const triH = cellSize * Math.sqrt(3) / 2; // 等边三角形高
  const halfW = cellSize / 2;               // 半列宽

  const col = Math.floor(px / halfW);
  const row = Math.floor(py / triH);

  // 局部坐标（在 halfW × triH 的小矩形内）
  const localX = (px - col * halfW) / halfW;   // [0, 1)
  const localY = (py - row * triH) / triH;     // [0, 1)

  // 奇偶列决定对角线方向
  // 偶列：左上到右下对角（y = x → 上下三角）
  // 奇列：左下到右上对角（y = 1 - x）
  let sub: 0 | 1;
  if (col % 2 === 0) {
    sub = localY < localX ? 0 : 1;
  } else {
    sub = localY < (1 - localX) ? 0 : 1;
  }

  return `${row},${col},${sub}`;
}

// ─── 构建三角形 ID 网格 ───────────────────────────────────────────────────────

function buildTriGrid(w: number, h: number, cellSize: number): number[][] {
  const cellMap = new Map<string, number>();
  let nextId = 1;

  const grid: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const key = pixelToTriKey(x, y, cellSize);
      if (!cellMap.has(key)) {
        cellMap.set(key, nextId++);
      }
      grid[y][x] = cellMap.get(key)!;
    }
  }
  return grid;
}

// ─── 主导出函数 ──────────────────────────────────────────────────────────────

export function tessTriGrid(
  input: Record<string, unknown>
): Record<string, unknown> {
  const w = typeof input.width === "number" ? Math.max(4, Math.round(input.width)) : 80;
  const h = typeof input.height === "number" ? Math.max(4, Math.round(input.height)) : 80;
  const cellSize = typeof input.cellSize === "number" ? Math.max(2, input.cellSize) : 12;

  const regionGrid = buildTriGrid(w, h, cellSize);

  return { regionGrid };
}
