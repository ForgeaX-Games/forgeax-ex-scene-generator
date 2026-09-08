/**
 * grid_to_json — 把二维整数 grid 序列化为 JSON 字符串（供 text_panel / house_template.spec 等）。
 */

type Grid = number[][]

function isGrid(val: unknown): val is Grid {
  if (!Array.isArray(val) || val.length === 0) return false
  for (const row of val) {
    if (!Array.isArray(row)) return false
    for (const cell of row) {
      if (typeof cell !== 'number' || !Number.isFinite(cell)) return false
    }
  }
  return true
}

export function gridToJson(input: Record<string, unknown>): Record<string, unknown> {
  const grid = input.grid
  if (!isGrid(grid)) {
    return { json: '', error: 'grid is required (number[][])' }
  }
  return { json: JSON.stringify(grid), error: '' }
}
