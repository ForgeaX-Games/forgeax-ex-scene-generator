/** Shared point2d list parsing for road / houses / guide batteries. */

import type { Vec2 } from './spline.js'
export type { Vec2 }

function isPointLike(v: unknown): boolean {
  if (Array.isArray(v)) return v.length >= 2 && Number.isFinite(Number(v[0])) && Number.isFinite(Number(v[1]))
  return !!v && typeof v === 'object' && 'x' in v && 'y' in v
}

export function unwrapPointList(raw: unknown): unknown {
  let list: unknown = raw
  for (let depth = 0; depth < 4; depth++) {
    if (typeof list === 'string') {
      try { list = JSON.parse(list); continue } catch { return [] }
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

export function parsePoint2d(raw: unknown): [number, number] | null {
  if (!raw) return null
  let val: unknown = raw
  if (Array.isArray(val) && val.length === 1) val = val[0]
  if (typeof val === 'string') {
    try { val = JSON.parse(val) } catch { return null }
    if (Array.isArray(val) && val.length === 1) val = val[0]
  }
  if (Array.isArray(val) && val.length >= 2) {
    const x = Number(val[0]), y = Number(val[1])
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
  }
  if (val && typeof val === 'object' && 'x' in val && 'y' in val) {
    const x = Number((val as { x: unknown }).x), y = Number((val as { y: unknown }).y)
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
  }
  return null
}

export function parsePoint2dList(raw: unknown): Vec2[] {
  const list = unwrapPointList(raw)
  if (!Array.isArray(list)) return []
  const out: Vec2[] = []
  for (const pt of list) {
    let col: number
    let row: number
    if (Array.isArray(pt) && pt.length >= 2) {
      col = Number(pt[0]); row = Number(pt[1])
    } else if (pt && typeof pt === 'object' && 'x' in pt && 'y' in pt) {
      col = Number((pt as { x: unknown }).x)
      row = Number((pt as { y: unknown }).y)
    } else continue
    if (Number.isFinite(col) && Number.isFinite(row)) out.push([col, row])
  }
  return out
}

export function sampleGridHeight(grid: unknown, x: number, y: number): number {
  if (!Array.isArray(grid) || grid.length === 0) return 0
  const ix = Math.max(0, Math.min(Math.round(x), ((grid[0] as unknown[])?.length ?? 1) - 1))
  const iy = Math.max(0, Math.min(Math.round(y), grid.length - 1))
  const row = grid[iy]
  if (!Array.isArray(row)) return 0
  const n = Number(row[ix])
  return Number.isFinite(n) ? n : 0
}
