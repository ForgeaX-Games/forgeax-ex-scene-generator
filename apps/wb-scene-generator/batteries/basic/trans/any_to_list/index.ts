/**
 * anyToList: 将多个任意值收集为一个列表
 * 输入：item_0, item_1, ... (any) — 动态多端口，各输入值按顺序收集
 * 输出：list (array) — 由所有已连接输入值组成的列表（跳过未连接的 undefined）
 */

export function anyToList(input: Record<string, unknown>): Record<string, unknown> {
  const portCount = typeof input.portCount === "number" ? input.portCount : 1;

  const list: unknown[] = [];
  for (let i = 0; i < portCount; i++) {
    const val = input[`item_${i}`];
    if (val !== undefined) {
      list.push(val);
    }
  }

  return { list };
}
