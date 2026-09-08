/**
 * manual_points — 手动设置点位（construct point2d）。
 *
 * 输入数值 x、y 两个分量，构造成单个 point2d 点输出，
 * 可直接接入需要 point2d 的下游电池（如 point2rect）。
 */
import { makePoint2D } from '../../../../vendor/dist/shared/types/index.js'

export function manualPoints(input: Record<string, unknown>): Record<string, unknown> {
  const x = Number(input.x ?? 0)
  const y = Number(input.y ?? 0)
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { point: null, error: 'x/y must be finite numbers' }
  }
  return { point: makePoint2D(x, y) }
}
