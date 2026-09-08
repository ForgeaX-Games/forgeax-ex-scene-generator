/**
 * maskFillHoles: 二值掩码内部空洞填充
 *
 * 算法：从地图四条边界出发，BFS 标记所有与边界连通的 0 格（外部空地）；
 * 剩余未被标记的 0 格即为被平台包围的"内部空洞"，统一置为 1（平台）。
 *
 * 输入：grid (binary mask, 1=平台 0=空地)
 * 输出：filledGrid (同尺寸 binary mask，内部空洞已填充)
 */

// --- 填充内部空洞 -------------------------------------------------------

function fillHoles(grid: number[][], w: number, h: number): number[][] {
  // 标记哪些 0 格是"外部"（与边界连通）
  const isExterior = new Uint8Array(w * h);

  const queue: number[] = [];

  const enqueue = (x: number, y: number) => {
    const idx = y * w + x;
    if (grid[y][x] === 0 && isExterior[idx] === 0) {
      isExterior[idx] = 1;
      queue.push(idx);
    }
  };

  // 从四条边界压入所有 0 格
  for (let x = 0; x < w; x++) {
    enqueue(x, 0);
    enqueue(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    enqueue(0, y);
    enqueue(w - 1, y);
  }

  // BFS 扩散，标记所有外部 0 格
  const DIRS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  let head = 0;
  while (head < queue.length) {
    const idx = queue[head++];
    const px = idx % w, py = (idx / w) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = px + dx, ny = py + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (grid[ny][nx] === 0 && isExterior[nIdx] === 0) {
        isExterior[nIdx] = 1;
        queue.push(nIdx);
      }
    }
  }

  // 构建输出：外部 0 格保留 0，内部 0 格（未被外部 BFS 到达）填为 1
  const filled: number[][] = Array.from({ length: h }, (_, y) =>
    Array.from({ length: w }, (_, x) => {
      if (grid[y][x] !== 0) return grid[y][x]; // 非零格原值保留
      return isExterior[y * w + x] === 0 ? 1 : 0;
    })
  );

  return filled;
}

// --- 主导出函数 ---------------------------------------------------------

export function maskFillHoles(
  input: Record<string, unknown>
): Record<string, unknown> {
  const rawGrid = input.grid;
  if (
    !Array.isArray(rawGrid) ||
    rawGrid.length === 0 ||
    !Array.isArray((rawGrid as unknown[][])[0])
  ) {
    return { error: "grid is required (number[][])" };
  }

  const grid = rawGrid as number[][];
  const h = grid.length;
  const w = grid[0].length;

  const filledGrid = fillHoles(grid, w, h);
  return { filledGrid };
}
