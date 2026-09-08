/**
 * point_select: 从网格中精准提取指定坐标的点
 * 输入：grid (grid) — 源网格；points (array) — 坐标列表，格式为 [[row,col], ...]
 * 输出：outputGrid (grid) — 与输入同尺寸，仅保留指定坐标处的原网格值，其余为 0
 */

/**
 * 将 points 输入解析为 [row, col] 二元组数组。
 * 支持以下格式：
 *   - 数组嵌套数组：[[1,2],[3,4]]
 *   - 字符串化的 JSON："[[1,2],[3,4]]"
 *   - 字符串元素数组：["1,2","3,4"] 或 ["(1,2)","(3,4)"]
 */
function parsePoints(raw: unknown): Array<[number, number]> {
  let data: unknown = raw;

  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(data)) return [];

  const result: Array<[number, number]> = [];
  for (const item of data) {
    if (Array.isArray(item) && item.length >= 2) {
      // 格式：[row, col]
      const row = Number(item[0]);
      const col = Number(item[1]);
      if (Number.isFinite(row) && Number.isFinite(col)) {
        result.push([Math.floor(row), Math.floor(col)]);
      }
    } else if (typeof item === "string") {
      // 格式："row,col" 或 "(row,col)"，去掉括号后按逗号分割
      const cleaned = item.replace(/[()[\]\s]/g, "");
      const parts = cleaned.split(",");
      if (parts.length >= 2) {
        const row = Number(parts[0]);
        const col = Number(parts[1]);
        if (Number.isFinite(row) && Number.isFinite(col)) {
          result.push([Math.floor(row), Math.floor(col)]);
        }
      }
    }
  }
  return result;
}

export function pointSelect(input: Record<string, unknown>): Record<string, unknown> {
  const grid = input.grid as number[][] | undefined;
  if (!grid || grid.length === 0 || grid[0].length === 0) {
    return { error: "grid is required and must be non-empty" };
  }

  const points = parsePoints(input.points);
  if (points.length === 0) {
    return { error: "points is required and must be a non-empty array of [row, col] pairs" };
  }

  const rows = grid.length;
  const cols = grid[0].length;
  const outputGrid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (const [r, c] of points) {
    if (r >= 0 && r < rows && c >= 0 && c < cols) {
      outputGrid[r][c] = grid[r][c];
    }
  }

  return { outputGrid };
}
