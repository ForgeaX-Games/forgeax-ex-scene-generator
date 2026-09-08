/**
 * strToNumList: 将 JSON 数字数组字符串（如 `[1,2,3]` 或 `["12","1","3"]`）解析为数字列表
 * 输入：str (string) — 形如 `[1,2,3]` 或 `["12","1","3"]` 的 JSON 字符串
 * 输出：list (array) — 解析后的数字列表
 */

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

export function strToNumList(input: Record<string, unknown>): Record<string, unknown> {
  const str = input.str;

  if (typeof str !== "string" || str.trim() === "") {
    return { error: "str is required and must be a non-empty string", list: [] };
  }

  const parsed = tryParseJSON(str.trim());
  if (parsed === null) {
    return { error: "str could not be parsed as JSON", list: [] };
  }

  if (!Array.isArray(parsed)) {
    return { error: "parsed value is not an array", list: [] };
  }

  const list: number[] = [];
  for (const item of parsed) {
    const num = Number(item);
    if (isNaN(num)) {
      return { error: `element "${item}" cannot be converted to a number`, list: [] };
    }
    list.push(num);
  }

  return { list };
}
