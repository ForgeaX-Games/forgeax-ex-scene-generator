/**
 * shoreExpander: 对合并后的地形+河流网格做 BFS 扩张，生成河岸沙滩过渡带
 * 输入：terrainGrid (grid) — 合并后的地形网格;
 *       shoreWidth (number) — 沙滩宽度（格数）;
 *       riverId (number) — 河流格标识值（默认 10）;
 *       shoreId (number) — 沙滩格标识值（默认 2）
 * 输出：terrainGrid (grid) — 带河岸沙滩的最终网格
 *
 * 算法：BFS 从所有河流格出发，逐层扩张 shoreWidth 层，
 * 将扩张到的非河流格改写为 shoreId（不覆盖已有河流格）
 */

export function shoreExpander(input: Record<string, unknown>): Record<string, unknown> {
  const rawGrid = input.terrainGrid as number[][] | undefined;
  if (!rawGrid || !Array.isArray(rawGrid) || rawGrid.length === 0) {
    return { error: "terrainGrid is required and must be a non-empty 2D array" };
  }

  const shoreWidth = Math.max(0, Math.round(typeof input.shoreWidth === "number" ? input.shoreWidth : 3));
  const riverId    = Math.round(typeof input.riverId   === "number" ? input.riverId   : 10);
  const shoreId    = Math.round(typeof input.shoreId   === "number" ? input.shoreId   : 2);

  const rows = rawGrid.length;
  const cols = rawGrid[0].length;

  // 深拷贝避免修改原网格
  const grid: number[][] = rawGrid.map(row => [...row]);

  if (shoreWidth === 0) return { terrainGrid: grid };

  // BFS 从所有河流格出发
  // visited 记录距河流格的最小步数，-1=未访问
  const visited: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  const queue: Array<[number, number]> = [];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (grid[y][x] === riverId) {
        visited[y][x] = 0;
        queue.push([y, x]);
      }
    }
  }

  // 四方向邻居
  const dirs: Array<[number, number]> = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  let head = 0;
  while (head < queue.length) {
    const [cy, cx] = queue[head++];
    const depth = visited[cy][cx];
    if (depth >= shoreWidth) continue;

    for (const [dy, dx] of dirs) {
      const ny = cy + dy;
      const nx = cx + dx;
      if (ny < 0 || ny >= rows || nx < 0 || nx >= cols) continue;
      if (visited[ny][nx] !== -1) continue; // 已访问

      visited[ny][nx] = depth + 1;
      queue.push([ny, nx]);

      // 非河流格 → 改写为沙滩
      if (grid[ny][nx] !== riverId) {
        grid[ny][nx] = shoreId;
      }
    }
  }

  return { terrainGrid: grid };
}
