/**
 * strToList: 将 JSON 字符串解析为数组（脱壳），保留元素原始类型
 * 输入：str (string) — 形如 `[...]` 的 JSON 字符串，元素可为任意类型
 * 输出：list (array) — 解析后的数组，元素原样保留（字符串/数字/对象/布尔均不转换）
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

export function strToList(input: Record<string, unknown>): Record<string, unknown> {
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

  return { list: parsed };
}
