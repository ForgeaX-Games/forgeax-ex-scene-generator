/**
 * promptDealer 电池执行函数
 *
 * 行为：将多个字符串值填入模板中的 {0}, {1}, {2}... 占位符，输出替换后的完整字符串。
 * - template 端口：模板字符串，通过上游连线传入
 * - value_0, value_1, ...：替换 {0}, {1}, ... 的值，数量由 portCount 决定
 * - portCount：前端在连线/断线时同步到 node.params，执行引擎 Step1 注入为 input.portCount
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>
 */
export function promptDealer(input: Record<string, unknown>): Record<string, unknown> {
  const template = (input.template !== undefined && input.template !== null)
    ? String(input.template)
    : ''

  if (!template) {
    return { prompt: '' }
  }

  const portCount = typeof input.portCount === 'number' ? input.portCount : 2
  let result = template

  for (let i = 0; i < portCount; i++) {
    const val = input[`value_${i}`]
    if (val !== undefined && val !== null) {
      result = result.split(`{${i}}`).join(String(val))
    }
  }

  return { prompt: result }
}
