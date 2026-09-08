/**
 * control_points — 控制点列（Control Surface 几何参数一等值）。
 *
 * 接收 point2d list 参数（如 [[6,24],[18,20],[30,26],[42,22]]），
 * 统一归一化为 Point2D 列表输出。
 */
import { makePoint2D, type Point2D } from '../../../../vendor/dist/shared/types/index.js'

function isPointLike(v: unknown): boolean {
  if (Array.isArray(v)) return v.length >= 2 && Number.isFinite(Number(v[0])) && Number.isFinite(Number(v[1]))
  return !!v && typeof v === 'object' && 'x' in v && 'y' in v
}

function unwrapPointList(raw: unknown): unknown {
  let list: unknown = raw
  for (let depth = 0; depth < 4; depth++) {
    if (typeof list === 'string') {
      try {
        list = JSON.parse(list)
        continue
      } catch {
        return []
      }
    }
    if (!Array.isArray(list)) return list
    if (list.length === 1 && !isPointLike(list[0]) && (Array.isArray(list[0]) || typeof list[0] === 'string')) {
      list = list[0]
      continue
    }
    return list
  }
  return list
}

export function parsePointsList(raw: unknown): Point2D[] {
  const list = unwrapPointList(raw)
  if (!Array.isArray(list)) return []

  const out: Point2D[] = []
  for (const pt of list) {
    let x: number, y: number
    if (Array.isArray(pt) && pt.length >= 2) {
      x = Number(pt[0])
      y = Number(pt[1])
    } else if (pt && typeof pt === 'object' && 'x' in pt && 'y' in pt) {
      x = Number((pt as { x: unknown }).x)
      y = Number((pt as { y: unknown }).y)
    } else {
      continue
    }
    if (Number.isFinite(x) && Number.isFinite(y)) {
      out.push(makePoint2D(x, y))
    }
  }
  return out
}

export function controlPoints(input: Record<string, unknown>): Record<string, unknown> {
  const pts = parsePointsList(input.points)
  return {
    points: pts,
    count: pts.length,
  }
}
