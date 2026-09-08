/**
 * points_to_grid 的点列表归一化：把 point2d 列表宽松地解析成 (x, y) 数对数组。
 *
 * 主输入为 point2d 列表（[{x,y}, ...]），同时兼容单个点、[x,y] 数组、"(x,y)" 字符串。
 * 第一个数字为 x，第二个为 y（point2d 世界坐标，非行列）。非法项静默丢弃。
 */

export type XY = { x: number; y: number }

function toXY(item: unknown): XY | null {
  if (Array.isArray(item) && item.length >= 2) {
    const x = Number(item[0])
    const y = Number(item[1])
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
  }
  if (typeof item === 'string') {
    const cleaned = item.replace(/[()[\]\s]/g, '')
    if (!cleaned) return null
    const parts = cleaned.split(',')
    if (parts.length >= 2 && parts[0] !== '' && parts[1] !== '') {
      const x = Number(parts[0])
      const y = Number(parts[1])
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
    }
    return null
  }
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>
    if ('x' in o && 'y' in o) {
      const x = Number(o.x)
      const y = Number(o.y)
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
    }
  }
  return null
}

export function normalizePoints(raw: unknown): XY[] {
  const arr = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
  const out: XY[] = []
  for (const item of arr) {
    const p = toXY(item)
    if (p) out.push(p)
  }
  return out
}
