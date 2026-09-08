/**
 * strToDict: 将形如 `{"key":"value",...}` 的 JSON 字符串解析为字典对象
 * 输入：str (string) — 形如 `{"key":"value",...}` 的 JSON 字符串
 * 输出：dict (dict) — 解析后的键值对字典
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

export function strToDict(input: Record<string, unknown>): Record<string, unknown> {
  const str = input.str;

  if (typeof str !== "string" || str.trim() === "") {
    return { error: "str is required and must be a non-empty string", dict: {} };
  }

  const parsed = tryParseJSON(str.trim());
  if (parsed === null) {
    return { error: "str could not be parsed as JSON", dict: {} };
  }

  if (Array.isArray(parsed) || typeof parsed !== "object" || parsed === null) {
    return { error: "parsed value is not an object", dict: {} };
  }

  return { dict: parsed };
}
