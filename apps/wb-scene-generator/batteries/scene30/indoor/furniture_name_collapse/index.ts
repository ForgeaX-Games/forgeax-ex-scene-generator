/**
 * furnitureNameCollapse: 将逐房间家具索引 + 实体网格按名称折叠
 *
 * 逐房间放置器输出的 maskA 中，像素值 = rank（每房间偏移1000），同名家具在不同房间有不同 rank，
 * 本电池将"同名家具的所有 rank"合并映射到同一个新 id（从1起连续），同步重写 maskA 像素值。
 *
 * 输入：list  (array) — [{rank, name, isGroup?, ...}]，来自 per_room / adaptive_room placer 的 furnitureIndex
 *       maskA (grid)  — 家具实体网格，像素值 = rank
 *       type  (string)— 输出 nameList 的 type 字段，默认 "asset"
 *
 * 输出：outputGrid (grid)  — 重映射后的家具网格，像素值 = 新连续 id（1起）
 *       nameList   (array) — [{id, name, type}]，按首次出现顺序去重，id 与 outputGrid 对应
 *       count      (number)— 唯一家具种数
 */

type Grid = number[][];

type NameListItem = {
  id: number;
  name: string;
  type: string;
  direction?: string;
};

export function furnitureNameCollapse(input: Record<string, unknown>): Record<string, unknown> {
  const rawList = input.list;
  const maskA = input.maskA as Grid | undefined;
  const typeValue = typeof input.type === "string" ? input.type : "asset";

  if (!Array.isArray(rawList)) {
    return { error: "list 输入必须是数组" };
  }
  if (!maskA || !Array.isArray(maskA) || maskA.length === 0) {
    return { error: "maskA 输入必须是非空二维网格" };
  }

  // 每个唯一 rank（实例）分配独立 id，同名家具多个实例各有独立 id
  const rankToNewId = new Map<number, number>();
  const nameList: NameListItem[] = [];

  for (const item of rawList) {
    if (typeof item !== "object" || item === null) continue;
    const obj = item as Record<string, unknown>;
    const rank = typeof obj.rank === "number" ? obj.rank : Number(obj.rank);
    const name = typeof obj.name === "string" ? obj.name.trim() : String(obj.name ?? "").trim();
    if (isNaN(rank) || !name || rankToNewId.has(rank)) continue;

    const newId = nameList.length + 1;
    rankToNewId.set(rank, newId);

    const entry: NameListItem = { id: newId, name, type: typeValue };
    if (typeof obj.direction === "string") entry.direction = obj.direction;
    nameList.push(entry);
  }

  // 重写 maskA，把所有旧 rank 像素值替换为新 id
  const rows = maskA.length;
  const cols = maskA[0]?.length ?? 0;
  const outputGrid: Grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const v = maskA[r][c];
      if (v === 0) return 0;
      return rankToNewId.get(v) ?? 0;
    })
  );

  return {
    outputGrid,
    nameList,
    count: nameList.length,
  };
}
