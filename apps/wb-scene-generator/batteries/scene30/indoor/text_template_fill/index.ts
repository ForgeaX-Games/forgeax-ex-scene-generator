/**
 * text_template_fill: 文本模板填充
 *
 * 将三个字符串值依次替换模板中的 {0} {1} {2} 占位符，输出完整文本。
 * 未连接的占位符端口保留默认空字符串，对应占位符原样保留在输出中。
 *
 * 输入：template (string) — 含占位符的模板；value_0~2 (string) — 替换值
 * 输出：text (string) — 替换后的完整文本
 */

export function textTemplateFill(input: Record<string, unknown>): Record<string, unknown> {
  const template = input.template != null ? String(input.template) : "";

  if (!template) {
    return { text: "" };
  }

  let text = template;
  for (let i = 0; i <= 2; i++) {
    const val = input[`value_${i}`];
    if (val != null && String(val) !== "") {
      text = text.split(`{${i}}`).join(String(val));
    }
  }

  return { text };
}
