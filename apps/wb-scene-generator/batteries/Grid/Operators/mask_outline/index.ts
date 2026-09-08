/**
 * mask_outline: 提取非零掩码的轮廓（单网格逐项变换）
 * 输入：inputGrid (grid, access:item) — 源网格，所有非零值视为掩码区域
 *       thickness (number) — 轮廓厚度（正数=向内取轮廓，负数=向外扩展后取轮廓边缘），默认 1
 * 输出：outputGrid (grid, access:item) — 与输入等尺寸，轮廓区域=1，其余=0
 *
 * 每次调用只处理一张网格；多网格批处理交由 dispatcher 的 access:item fanout，
 * execute 不再自行遍历网格列表。
 *
 * 算法：
 *   先找到"边界像素集合"：非零且至少有一个4邻域邻居为零（或越界）的像素
 *   thickness > 0：从边界像素出发，在掩码内部向内膨胀 thickness-1 次（内轮廓）
 *   thickness < 0：从边界像素出发，在掩码外部向外膨胀 |thickness|-1 次（外轮廓）
 *   thickness = 0：返回全零网格
 *
 * 使用边界像素出发+受限膨胀，保证凹角处轮廓连续不断开
 */

// 对 mask 执行一次4邻域膨胀，结果可选裁剪到 clipMask 范围内
function dilateClipped(
  mask: boolean[][],
  rows: number,
  cols: number,
  clipMask: boolean[][] | null
): boolean[][] {
  const result: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!mask[r][c]) continue;
      const neighbors: [number, number][] = [
        [r, c], [r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]
      ];
      for (const [nr, nc] of neighbors) {
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (clipMask && !clipMask[nr][nc]) continue;
        result[nr][nc] = true;
      }
    }
  }
  return result;
}

// 8邻域偏移
const DIRS8: [number, number][] = [
  [-1, -1], [-1, 0], [-1, 1],
  [ 0, -1],          [ 0, 1],
  [ 1, -1], [ 1, 0], [ 1, 1],
];

// 找边界像素：非零且8邻域中至少有一个方向为零或越界
// 使用8邻域确保凹角处的内角像素也被识别为边界，避免轮廓断开
function findBorderPixels(mask: boolean[][], rows: number, cols: number): boolean[][] {
  const border: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!mask[r][c]) continue;
      let hasOutside = false;
      for (const [dr, dc] of DIRS8) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || !mask[nr][nc]) {
          hasOutside = true;
          break;
        }
      }
      border[r][c] = hasOutside;
    }
  }
  return border;
}

// 找外边界像素：掩码外部且8邻域中至少有一个邻居是掩码内像素
function findOuterBorderPixels(mask: boolean[][], rows: number, cols: number): boolean[][] {
  const outer: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (mask[r][c]) continue;
      let hasMaskNeighbor = false;
      for (const [dr, dc] of DIRS8) {
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && mask[nr][nc]) {
          hasMaskNeighbor = true;
          break;
        }
      }
      outer[r][c] = hasMaskNeighbor;
    }
  }
  return outer;
}

// 对 mask 取反（在 baseMask 范围外的区域）
function invertOutside(mask: boolean[][], rows: number, cols: number): boolean[][] {
  const inv: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      inv[r][c] = !mask[r][c];
    }
  }
  return inv;
}

type Grid = number[][];

function isGrid(v: unknown): v is Grid {
  return Array.isArray(v) && v.length > 0 && Array.isArray((v as unknown[])[0]);
}

function outlineOne(inputGrid: Grid, thickness: number): Grid {
  const rows = inputGrid.length;
  const cols = inputGrid[0].length;

  if (thickness === 0) {
    return Array.from({ length: rows }, () => new Array(cols).fill(0));
  }

  const baseMask: boolean[][] = inputGrid.map(row => row.map(v => v !== 0));
  const outputGrid: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  if (thickness > 0) {
    let outline = findBorderPixels(baseMask, rows, cols);
    for (let i = 1; i < thickness; i++) {
      outline = dilateClipped(outline, rows, cols, baseMask);
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        outputGrid[r][c] = outline[r][c] ? 1 : 0;
      }
    }
  } else {
    const outsideClip = invertOutside(baseMask, rows, cols);
    let outline = findOuterBorderPixels(baseMask, rows, cols);
    for (let i = 1; i < -thickness; i++) {
      outline = dilateClipped(outline, rows, cols, outsideClip);
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        outputGrid[r][c] = outline[r][c] ? 1 : 0;
      }
    }
  }

  return outputGrid;
}

export function maskOutline(input: Record<string, unknown>): Record<string, unknown> {
  const rawInput = input.inputGrid;
  const thickness = Math.round(typeof input.thickness === "number" ? input.thickness : 1);

  if (rawInput == null) return { error: "inputGrid is required" };

  if (!isGrid(rawInput) || (rawInput as Grid)[0].length === 0) {
    return { error: "inputGrid must be a non-empty grid" };
  }

  return { outputGrid: outlineOne(rawInput as Grid, thickness) };
}
