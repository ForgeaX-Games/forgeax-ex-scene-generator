/**
 * points_along_polyline — 沿折线/道路生成地块分布点（宅基点）。
 *
 * 吃采样中线时：offset = 局部半宽 + margin，并输出 yaw 供房屋朝向。
 * 未给 widths/roadWidth 时仍用固定 offset，兼容旧图。
 */
import { makePoint2D, type Point2D } from '../../../../vendor/dist/shared/types/index.js'
import { parseNumberList } from '../../../../vendor/shared/types/scene/spline.js'
import { parsePointsList } from '../control_points/index.js'

function widthAt(widths: number[], roadWidth: number | undefined, t: number): number | undefined {
  if (widths.length === 0 && (roadWidth == null || !(roadWidth > 0))) return undefined
  if (widths.length === 0) return roadWidth
  if (widths.length === 1) return widths[0]
  const f = Math.max(0, Math.min(1, t)) * (widths.length - 1)
  const i0 = Math.min(widths.length - 2, Math.floor(f))
  const u = f - i0
  return widths[i0]! * (1 - u) + widths[i0 + 1]! * u
}

export function pointsAlongPolyline(input: Record<string, unknown>): Record<string, unknown> {
  const pts = parsePointsList(input.points)
  const count = Math.max(0, Math.floor(Number(input.count ?? 4)))
  const fallbackOffset = Number(input.offset ?? 4)
  const margin = typeof input.margin === 'number' && Number.isFinite(input.margin) ? input.margin : 2.2
  const roadWidth = typeof input.roadWidth === 'number' && input.roadWidth > 0 ? input.roadWidth : undefined
  const widths = parseNumberList(input.widths)

  if (pts.length < 2 || count <= 0) {
    return { points: [], yaw: [], count: 0 }
  }

  const segLengths: number[] = []
  let totalLength = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1]!.x - pts[i]!.x
    const dy = pts[i + 1]!.y - pts[i]!.y
    const len = Math.hypot(dx, dy)
    segLengths.push(len)
    totalLength += len
  }

  if (totalLength <= 0) {
    return { points: [], yaw: [], count: 0 }
  }

  const result: Point2D[] = []
  const yaw: number[] = []
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : 0.15 + (0.7 * i) / (count - 1)
    const targetDist = t * totalLength

    let accum = 0
    let segIdx = 0
    let localT = 0
    for (let s = 0; s < segLengths.length; s++) {
      if (accum + segLengths[s]! >= targetDist || s === segLengths.length - 1) {
        segIdx = s
        localT = segLengths[s]! > 0 ? (targetDist - accum) / segLengths[s]! : 0
        break
      }
      accum += segLengths[s]!
    }

    const p0 = pts[segIdx]!
    const p1 = pts[segIdx + 1]!
    const px = p0.x + (p1.x - p0.x) * localT
    const py = p0.y + (p1.y - p0.y) * localT

    const dx = p1.x - p0.x
    const dy = p1.y - p0.y
    const segLen = Math.hypot(dx, dy) || 1
    const tx = dx / segLen
    const ty = dy / segLen
    const nx = -ty
    const ny = tx
    const heading = Math.atan2(ty, tx)

    const localW = widthAt(widths, roadWidth, t)
    const offset = localW != null ? localW * 0.5 + margin : fallbackOffset
    const side = (i % 2 === 0 ? 1 : -1)
    const finalX = px + nx * offset * side
    const finalY = py + ny * offset * side

    result.push(makePoint2D(finalX, finalY))
    yaw.push(heading)
  }

  return {
    points: result,
    yaw,
    count: result.length,
  }
}
