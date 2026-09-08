/**
 * not: 对输入布尔值取反（逻辑非）。
 *
 * 输入：value (bool) — true→false，false→true。非布尔输入按真值判断后取反
 *       （空串 / "false" / "0" / 0 视为 false，其余为 true）。
 * 输出：result (bool)。
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>，
 * 端口 key 与 meta.json 对齐。
 */
function toBool(x: unknown): boolean {
  if (typeof x === 'boolean') return x
  if (typeof x === 'number') return x !== 0
  if (typeof x === 'string') {
    const s = x.trim().toLowerCase()
    return s !== '' && s !== 'false' && s !== '0'
  }
  return x !== undefined && x !== null
}

export function not(input: Record<string, unknown>): Record<string, unknown> {
  return { result: !toBool(input.value) }
}
