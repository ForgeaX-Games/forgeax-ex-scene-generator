/**
 * equals: 判断「条件」是否等于「规则」（按字符串比较）。
 *
 * 输入：condition (any) / rule (any) — 两边都转成字符串后比较。
 * 输出：result (bool) — 相等为 true，否则为 false。
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>，
 * 端口 key 与 meta.json 对齐。
 */
export function equals(input: Record<string, unknown>): Record<string, unknown> {
  const toStr = (x: unknown): string => (x === undefined || x === null ? '' : String(x))
  return { result: toStr(input.condition) === toStr(input.rule) }
}
