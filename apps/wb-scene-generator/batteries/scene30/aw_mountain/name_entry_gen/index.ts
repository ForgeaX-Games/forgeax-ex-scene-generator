/**
 * nameEntryGen: 用一个 id、名称、图层类型构造单条名称清单 [{id, name, type}]
 * 输入：id (number) — 数值 ID；name (string) — 名称；layerType (string) — 图层类型
 * 输出：nameList (array) — 单条名称清单 [{id, name, type}]
 */

export function nameEntryGen(input: Record<string, unknown>): Record<string, unknown> {
  const id = typeof input.id === "number" ? Math.round(input.id) : 1;
  const name = typeof input.name === "string" && input.name.trim() !== "" ? input.name.trim() : "未命名";
  const layerType = typeof input.layerType === "string" && input.layerType.trim() !== "" ? input.layerType.trim() : "";

  const entry: Record<string, unknown> = { id, name };
  if (layerType !== "") entry.type = layerType;

  return { nameList: [entry] };
}
