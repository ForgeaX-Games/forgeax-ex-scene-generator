/**
 * strToGrid: 将 JSON 字符串解析为一个 grid（二维整数数组）
 * 输入：str (string) — 形如 `[[1,2],[3,4]]` 的 JSON 字符串
 * 输出：grid (grid) — 解析后的二维整数数组
 */

type Grid2D = number[][];

/**
 * 尝试解析 JSON 字符串，支持最多 3 层嵌套字符串化（双重/三重 stringify）
 */
function tryParseJSON(str: string): unknown {
  let current: unknown = str;
  for (let i = 0; i < 3; i++) {
    if (typeof current !== "string") break;
    try {
      current = JSON.parse(current);
    } catch {
      break;
    }
  }
  return current === str ? null : current;
}

/**
 * 判断一个值是否为有效的 grid（number[][]）
 * 要求：非空数组，每个元素为非空数组，且所有元素均为数字
 */
function isValidGrid(val: unknown): val is Grid2D {
  if (!Array.isArray(val) || val.length === 0) return false;
  for (const row of val) {
    if (!Array.isArray(row) || row.length === 0) return false;
    for (const cell of row) {
      if (typeof cell !== "number" || !isFinite(cell)) return false;
    }
  }
  return true;
}

export function strToGrid(input: Record<string, unknown>): Record<string, unknown> {
  const str = input.str;

  if (typeof str !== "string" || str.trim() === "") {
    return { error: "str is required and must be a non-empty string" };
  }

  const parsed = tryParseJSON(str.trim());
  if (parsed === null) {
    return { error: "str could not be parsed as JSON" };
  }

  if (!isValidGrid(parsed)) {
    return { error: "parsed value is not a valid grid (expected a non-empty 2D number array)" };
  }

  return { grid: parsed };
}
