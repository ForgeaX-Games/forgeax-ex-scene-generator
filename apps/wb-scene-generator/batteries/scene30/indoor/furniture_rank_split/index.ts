/**
 * furnitureRankSplit: 将家具对象数组按 rank 拆成主列表（前7）和填充列表（后2）
 * 输入：list (array) — 家具对象数组（来自 furniture_list_split 电池）
 * 输出：main_list (array) — rank 1-7 的家具，rank 保持原值
 *       fill_list (array) — rank 8-9 的家具，rank 重置为 1、2
 */

export function furnitureRankSplit(
  input: Record<string, unknown>
): Record<string, unknown> {
  const list = input.list;

  if (!Array.isArray(list)) {
    return { error: "list is required and must be an array" };
  }

  const mainItems: Record<string, unknown>[] = [];
  const fillItems: Record<string, unknown>[] = [];

  for (const item of list) {
    const obj = item as Record<string, unknown>;
    const rank = obj["rank"];
    if (typeof rank === "number" && rank >= 8) {
      fillItems.push({ ...obj, rank: fillItems.length + 1 });
    } else {
      mainItems.push(obj);
    }
  }

  return {
    main_list: mainItems,
    fill_list: fillItems,
  };
}
