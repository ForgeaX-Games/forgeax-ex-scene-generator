/**
 * nameListGen: 批量生成名称列表，按 {名称}{N} 格式生成指定数量的字符串条目
 *
 * 行为：以 name 为前缀、1 起步的序号为后缀，生成 count 个字符串组成的数组，
 *       格式为 ["名称1", "名称2", ...]。
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>
 */

export function nameListGen(input: Record<string, unknown>): Record<string, unknown> {
  const count = typeof input.count === "number" ? Math.max(0, Math.floor(input.count)) : 1;
  const name = typeof input.name === "string" && input.name.trim() !== ""
    ? input.name.trim()
    : "区域";

  const names: string[] = Array.from({ length: count }, (_, i) => `${name}${i + 1}`);

  return { names };
}
