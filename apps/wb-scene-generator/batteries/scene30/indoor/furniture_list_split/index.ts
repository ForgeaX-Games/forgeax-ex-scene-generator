/**
 * furnitureListSplit: 将 gemini_query 原始 JSON 文字解析为家具对象数组
 * 输入：result (string) — LLM 电池输出的原始 JSON 字符串
 * 输出：list (array) — furniture_list 中每个家具对象组成的数组
 */

function stripMarkdownCodeBlock(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```[a-z]*\n?/i, "")
      .replace(/\n?```$/, "")
      .trim();
  }
  return trimmed;
}

export function furnitureListSplit(
  input: Record<string, unknown>
): Record<string, unknown> {
  const rawJson =
    typeof input.result === "string"
      ? input.result
      : typeof input.raw_json === "string"
      ? input.raw_json
      : "";

  if (!rawJson.trim()) {
    return { error: "result is required" };
  }

  const cleaned = stripMarkdownCodeBlock(rawJson);

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return { error: "result is not valid JSON" };
  }

  const furnitureList = data["furniture_list"];
  if (!Array.isArray(furnitureList)) {
    return { error: "furniture_list field is missing or not an array" };
  }

  return { list: furnitureList };
}
