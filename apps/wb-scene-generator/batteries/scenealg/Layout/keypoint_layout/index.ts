/**
 * keypoint_layout — 给 keypoint 层级树的每个节点求解一个 2D 位置（米）。
 *
 * 把面积/clearance/方位关系建模为可微能量项，叠加"父=子加权平均""非重叠""紧凑性"
 * 正则，用确定性的 Adam 梯度下降最小化总能量。输出与输入结构一致、但每个节点附带
 * position:{x,y} 的 keypoint 字典，可直接接入 keypoint_graph 按真实点位绘制。
 *
 * 算法内部解耦在 solver/ 下：model（建模）/ config（权重超参）/ terms（各约束）/
 * optimizer（求解）/ solve（归一化编排）/ attach（写回）。
 */
import { buildModel } from './solver/model.ts'
import { solve } from './solver/solve.ts'
import { attachPositions } from './solver/attach.ts'

export function keypointLayout(input: Record<string, unknown>): Record<string, unknown> {
  const raw = input.keypoint
  const model = buildModel(raw)
  if (model.nodes.length === 0) return { keypoint: raw }
  const result = solve(model)
  return { keypoint: attachPositions(raw, model, result) }
}
