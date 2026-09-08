/**
 * listExplode: 解析 JSON 数组字符串并拆分为动态输出端口，每个元素对应一个 item_N 端口
 * 输入：list (string) — 形如 [...] 的 JSON 数组字符串
 * 输出：item_0, item_1, … (any) — 列表中各元素，原封不动输出
 */

function parseJsonArray(str: string): unknown[] | null {
  let current: unknown = str;
  for (let i = 0; i < 3; i++) {
    if (typeof current !== "string") break;
    try { current = JSON.parse(current); } catch { break; }
  }
  return Array.isArray(current) ? current : null;
}

export function listExplode(input: Record<string, unknown>): Record<string, unknown> {
  const raw = input.list;

  if (typeof raw !== "string" || raw.trim() === "") {
    return { error: "list is required and must be a non-empty string" };
  }

  const arr = parseJsonArray(raw.trim());
  if (arr === null) {
    return { error: "list could not be parsed as a JSON array" };
  }

  const output: Record<string, unknown> = {};
  arr.forEach((item, i) => {
    output[`item_${i}`] = item;
  });
  return output;
}
