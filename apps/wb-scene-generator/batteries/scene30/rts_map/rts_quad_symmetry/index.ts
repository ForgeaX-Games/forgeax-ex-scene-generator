/**
 * rtsQuadSymmetry: 四重旋转对称展开
 * 将 1/4 区域 quadGrid 分别旋转 0°/90°/180°/270° 后放置于完整地图的四个角落。
 * 完整地图尺寸从 originalGrid 中读取，fullGrid 从全零开始，仅写入四角基地形状。
 * 输入：originalGrid (grid) — 原始完整网格（用于确定尺寸）；
 *       quadGrid (grid) — 左上角经 rts_base_shape_gen 处理后的基地形状；
 *       mode (string) — 4way/2way；padding (number) — 角落内边距
 * 输出：fullGrid (grid) — 含四角基地的完整平台掩码；baseCenters (array) — 各基地质心坐标
 */

// ─── 旋转操作 ────────────────────────────────────────────────────────────────

/** 顺时针旋转 90°：H×W → W×H */
function rotate90CW(grid: number[][]): number[][] {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  if (h === 0 || w === 0) return [];

  const result: number[][] = Array.from({ length: w }, () =>
    new Array(h).fill(0)
  );
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      result[x][h - 1 - y] = grid[y][x];
    }
  }
  return result;
}

// ─── 将 src 叠加到 dest 的指定偏移位置 ────────────────────────────────────

function stampGrid(
  dest: number[][],
  src: number[][],
  offsetX: number,
  offsetY: number
): void {
  const destH = dest.length;
  const destW = dest[0]?.length ?? 0;
  for (let y = 0; y < src.length; y++) {
    for (let x = 0; x < (src[y]?.length ?? 0); x++) {
      if (src[y][x] === 0) continue;
      const dy = offsetY + y;
      const dx = offsetX + x;
      if (dy >= 0 && dy < destH && dx >= 0 && dx < destW) {
        dest[dy][dx] = src[y][x];
      }
    }
  }
}

// ─── 计算有效格（非零格）的质心坐标 ──────────────────────────────────────

function computeCentroid(
  grid: number[][],
  offsetX: number,
  offsetY: number
): { x: number; y: number } {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < (grid[y]?.length ?? 0); x++) {
      if (grid[y][x] !== 0) {
        sumX += offsetX + x;
        sumY += offsetY + y;
        count++;
      }
    }
  }
  if (count === 0) {
    const h = grid.length;
    const w = grid[0]?.length ?? 0;
    return { x: offsetX + Math.floor(w / 2), y: offsetY + Math.floor(h / 2) };
  }
  return { x: Math.round(sumX / count), y: Math.round(sumY / count) };
}

// ─── 导出入口 ────────────────────────────────────────────────────────────────

export function rtsQuadSymmetry(
  input: Record<string, unknown>
): Record<string, unknown> {
  // 验证 originalGrid
  const rawOrig = input.originalGrid;
  if (
    !Array.isArray(rawOrig) ||
    rawOrig.length === 0 ||
    !Array.isArray((rawOrig as unknown[][])[0])
  ) {
    return { error: "originalGrid is required (number[][])" };
  }
  const originalGrid = rawOrig as number[][];

  // 验证 quadGrid
  const rawQuad = input.quadGrid;
  if (
    !Array.isArray(rawQuad) ||
    rawQuad.length === 0 ||
    !Array.isArray((rawQuad as unknown[][])[0])
  ) {
    return { error: "quadGrid is required (number[][])" };
  }
  const quadGrid = rawQuad as number[][];

  const mapHeight = originalGrid.length;
  const mapWidth = originalGrid[0]?.length ?? 0;
  const padding = 0;
  const mode =
    typeof input.mode === "string" ? input.mode : "4way";

  // 生成四个旋转变体
  const q0 = quadGrid;          // 左上（原始）
  const q1 = rotate90CW(q0);   // 右上（顺时针90°）
  const q2 = rotate90CW(q1);   // 右下（180°）
  const q3 = rotate90CW(q2);   // 左下（270°）

  // fullGrid 以全零初始化，仅将基地形状叠入四角
  const fullGrid: number[][] = Array.from({ length: mapHeight }, () =>
    new Array(mapWidth).fill(0)
  );

  // 各旋转变体的尺寸
  const q0H = q0.length, q0W = q0[0]?.length ?? 0;
  const q1H = q1.length, q1W = q1[0]?.length ?? 0;
  const q2H = q2.length, q2W = q2[0]?.length ?? 0;
  const q3H = q3.length, q3W = q3[0]?.length ?? 0;

  // 放置偏移：每个角落的左上角坐标
  const topLeftX = padding;
  const topLeftY = padding;
  const topRightX = mapWidth - padding - q1W;
  const topRightY = padding;
  const botRightX = mapWidth - padding - q2W;
  const botRightY = mapHeight - padding - q2H;
  const botLeftX = padding;
  const botLeftY = mapHeight - padding - q3H;

  // 左上角
  stampGrid(fullGrid, q0, topLeftX, topLeftY);
  const center0 = computeCentroid(q0, topLeftX, topLeftY);

  // 右上角（仅 4way）
  const center1 =
    mode === "4way"
      ? (() => {
          stampGrid(fullGrid, q1, topRightX, topRightY);
          return computeCentroid(q1, topRightX, topRightY);
        })()
      : null;

  // 右下角
  stampGrid(fullGrid, q2, botRightX, botRightY);
  const center2 = computeCentroid(q2, botRightX, botRightY);

  // 左下角（仅 4way）
  const center3 =
    mode === "4way"
      ? (() => {
          stampGrid(fullGrid, q3, botLeftX, botLeftY);
          return computeCentroid(q3, botLeftX, botLeftY);
        })()
      : null;

  const baseCenters =
    mode === "4way"
      ? [center0, center1, center2, center3]
      : [center0, center2];

  return { fullGrid, baseCenters };
}
