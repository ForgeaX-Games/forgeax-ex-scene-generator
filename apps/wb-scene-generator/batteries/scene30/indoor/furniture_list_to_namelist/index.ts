/**
 * furniture_list_to_namelist: 将家具清单转换为渲染器名称清单
 * 输入：list (array) — 家具清单，每项含 rank, name, isGroup 字段；type (string) — 输出 type 值
 * 输出：nameList (array) — {id, name, type}[] 格式的渲染器名称清单
 */

type FurnitureItem = {
  rank: number;
  name: string;
  isGroup?: boolean;
  [key: string]: unknown;
};

type NameListItem = {
  id: number;
  name: string;
  type: string;
};

function convertItem(item: FurnitureItem, typeValue: string): NameListItem {
  return {
    id: item.rank,
    name: item.name,
    type: typeValue,
  };
}

export function furnitureListToNamelist(input: Record<string, unknown>): Record<string, unknown> {
  const rawList = input.list;
  const typeValue = typeof input.type === "string" ? input.type : "asset";

  if (!Array.isArray(rawList)) {
    return { error: "list 输入必须是数组" };
  }

  const nameList: NameListItem[] = [];

  for (const item of rawList) {
    if (typeof item !== "object" || item === null) continue;

    const obj = item as Record<string, unknown>;
    const rank = typeof obj.rank === "number" ? obj.rank : Number(obj.rank);
    const name = typeof obj.name === "string" ? obj.name : String(obj.name ?? "");

    if (isNaN(rank) || !name) continue;

    nameList.push(convertItem({ rank, name } as FurnitureItem, typeValue));
  }

  return { nameList };
}
