/**
 * keypoint_graph — 零变换透传 keypoint 字典，供画布节点展示力导向关系图 + 层级清单。
 */
export function keypointGraph(input: Record<string, unknown>): Record<string, unknown> {
  return { keypoint: input.keypoint }
}
