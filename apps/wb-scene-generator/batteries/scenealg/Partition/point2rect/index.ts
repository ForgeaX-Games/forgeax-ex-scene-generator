/**
 * point2rect — 区域内点生矩形。
 *
 * 输入一张 01 区域网格、一个采样 point2d 点，以及目标宽/高；在区域的"1"内寻找一个
 * 包含该点（点落在 0 上则取最近的 1 格）、完整落在区域内、中心尽量贴近该点、长宽尽量
 * 接近输入的矩形，放不下就缩小，输出与输入同形状、矩形处为 1 的新网格。算法解耦在 rectFit.ts。
 *
 * 2026-07-01 postmortem（市集/灯柱/石柱/彼岸花/假山"空产"排查，见
 * PlaceOneDecoration/PickOneBuilding 两个模板组的唯一消费方 alg_point2rect）：
 * 本函数曾在"区域全 0（无任何可用格）"时静默输出同形状全 0 网格、不报 error——这本是
 * 早期"放不下就退化"的既定约定（旧注释：区域全 0 时输出同形状全 0 网格）。但
 * PlaceOneDecoration/PickOneBuilding 是"精准单点放置"模板：outputGrid 全 0 会一路
 * 静默传到 grid2node（0 体素但不报错）→ add_child（子节点非空数组，同样不报错）——
 * 整条链路"成功"落地一个看不见、没有体素的装饰/建筑节点，`execute` 摘要里查不到任何
 * error，调用方无法察觉、也无法自纠正，只会看到"空产"。当时曾被误诊为外层
 * graph mutation 门控问题；真正病灶是这里"放不下就静默退化成全 0，而非报错"
 * 的历史约定。现在改为显式 error，
 * 说明区域尺寸、采样点与失败原因，方便 Sino 定位是 Scene/Rest 端口悬空未接，还是目标
 * 位置已被占满。
 */
import { fitRect, stampRect } from './rectFit.ts'

export function point2rect(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as number[][] | undefined
  if (!region || region.length === 0 || !Array.isArray(region[0]) || region[0].length === 0) {
    return { error: 'region is required and must be a non-empty grid' }
  }
  const rows = region.length
  const cols = region[0].length

  const point = input.point as { x?: unknown; y?: unknown } | null | undefined
  const px = Number(point?.x)
  const py = Number(point?.y)
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    return { error: 'point is required and must be a point2d {x,y}' }
  }

  const width = Number(input.width ?? 5)
  const height = Number(input.height ?? 5)

  const rect = fitRect({ region, px, py, width, height })
  if (!rect) {
    // 区域全 0（无任何可用格）：显式报错而非静默退化成全 0 网格，见上方 2026-07-01 postmortem。
    return {
      error:
        `point2rect: no available (non-zero) cell in the ${rows}x${cols} region — cannot place a ` +
        `${width}x${height} rect near point (${px}, ${py}). The upstream Scene/Rest input is likely ` +
        `empty or disconnected, or this area is already fully occupied by other placed content. ` +
        `Check the template's Scene input port connection before retrying.`,
    }
  }
  return { outputGrid: stampRect(rows, cols, rect) }
}
