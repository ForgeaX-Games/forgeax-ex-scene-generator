/**
 * grid_json_to_size
 *
 * 解析二维列表格式的 JSON 字符串，按「每格 16px」计算其对应灰度图的尺寸：
 *   - width  = 列数 × 16
 *   - height = 行数 × 16
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>，
 * 端口 key 与 meta.json 对齐。
 */
const CELL_PX = 16

export function gridJsonToSize(input: Record<string, unknown>): Record<string, unknown> {
  const raw = input.json
  const text = raw === undefined || raw === null ? '' : String(raw).trim()

  if (!text) {
    return { width: 0, height: 0 }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { width: 0, height: 0 }
  }

  if (!Array.isArray(parsed)) {
    return { width: 0, height: 0 }
  }

  const rows = parsed.length
  let cols = 0
  for (const row of parsed) {
    if (Array.isArray(row) && row.length > cols) cols = row.length
  }

  return { width: cols * CELL_PX, height: rows * CELL_PX }
}
