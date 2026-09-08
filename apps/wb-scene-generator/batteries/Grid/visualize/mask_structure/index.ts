/**
 * mask_structure — 零变换透传 grid，供画布节点展示黑白 mask 圆点预览。
 */
export function maskStructure(input: Record<string, unknown>): Record<string, unknown> {
  return { grid: input.grid }
}
