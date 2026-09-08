/**
 * points2rects — 区域内点集生不重叠矩形。
 *
 * 输入一张 01 区域网格、一组采样 point2d 点，以及每个点的目标宽/高；在区域的"1"内为每个点
 * 贴合一个矩形：中心尽量贴近该点、长宽尽量接近输入、完整落在区域内，放不下就缩小，并且所有
 * 矩形互不重叠。空间竞争时按目标面积从大到小优先放置（大矩形先占更优位置）。
 *
 * 每个点输出为一张与输入同形状、矩形处为 1 的独立网格（rank=1 列表），顺序与输入点一致；
 * 放不下的点对应一张全 0 网格。算法解耦在 rectsFit.ts。
 *
 * width / height：长度为 1 时广播到所有点；否则按下标对应；缺省单值为 5。
 * 坐标约定：x→列、y→行。
 */
import { placeRects, type RectRequest } from './rectsFit.ts'

function toNumberArray(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((x) => Number(x))
  if (v === undefined || v === null || v === '') return []
  return [Number(v)]
}

/** 取第 i 个尺寸：单值广播到全部；否则按下标，越界/非有限回退到默认值。 */
function sizeAt(arr: number[], i: number, fallback: number): number {
  let raw: number
  if (arr.length === 1) raw = arr[0]
  else if (i < arr.length) raw = arr[i]
  else raw = fallback
  return Number.isFinite(raw) && raw >= 1 ? Math.round(raw) : fallback
}

export function points2rects(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as number[][] | undefined
  if (!region || region.length === 0 || !Array.isArray(region[0]) || region[0].length === 0) {
    return { error: 'region is required and must be a non-empty grid' }
  }

  const rawPoints = input.points
  const points = Array.isArray(rawPoints) ? rawPoints : rawPoints == null ? [] : [rawPoints]
  if (points.length === 0) {
    return { rects: [], placedCount: 0 }
  }

  const widths = toNumberArray(input.widths ?? input.width)
  const heights = toNumberArray(input.heights ?? input.height)

  const requests: RectRequest[] = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as { x?: unknown; y?: unknown } | null | undefined
    const px = Number(p?.x)
    const py = Number(p?.y)
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      return { error: `points[${i}] must be a point2d {x,y}` }
    }
    requests.push({
      px,
      py,
      width: sizeAt(widths, i, 5),
      height: sizeAt(heights, i, 5),
    })
  }

  const { grids, placedCount } = placeRects(region, requests)
  return { rects: grids, placedCount }
}
