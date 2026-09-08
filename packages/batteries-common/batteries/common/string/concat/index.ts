/**
 * StringConcat 字符串拼接电池执行函数
 *
 * 行为：把两个字符串首尾相接，可选地在中间插入分隔符，返回拼接结果
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>
 */
export function stringConcat(input: Record<string, unknown>): Record<string, unknown> {
  const toStr = (x: unknown): string => (typeof x === 'string' ? x : x == null ? '' : String(x))

  const a = toStr(input.a)
  const b = toStr(input.b)
  const separator = toStr(input.separator)

  const result = a + separator + b

  return { result }
}
