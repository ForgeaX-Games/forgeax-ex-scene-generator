/**
 * points_to_grid — 点列表栅格化为 01 mask。
 *
 * 输入一个 point2d 列表与一张区域网格，输出与区域同形状的 0/1 mask：
 * 凡是落在区域有效（非零）格、且命中点列表位置的格点标记为 1，其余为 0。
 * 坐标约定：x→列(col)、y→行(row)，四舍五入；越界坐标夹回最近的边界格
 * （如 200 宽地图的 x=200 吸附到第 199 列），落在区域外（0 格）的点忽略。
 */
import { normalizePoints } from './normalize.ts'

export function pointsToGrid(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as number[][] | undefined
  if (!region || region.length === 0 || !Array.isArray(region[0]) || region[0].length === 0) {
    return { error: 'region is required and must be a non-empty grid' }
  }
  const rows = region.length
  const cols = region[0].length

  const points = normalizePoints(input.points)
  const mask: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))

  for (const p of points) {
    // 边界吸附：落在地图右/下边界（x==cols 或 y==rows）的点夹回最后一格，
    // 避免用户输入地图尺寸级坐标（如 200 宽地图的 x=200）被静默丢弃而连不上。
    const c = Math.min(cols - 1, Math.max(0, Math.round(p.x)))
    const r = Math.min(rows - 1, Math.max(0, Math.round(p.y)))
    if (region[r][c] !== 0) {
      mask[r][c] = 1
    }
  }

  return { mask }
}
