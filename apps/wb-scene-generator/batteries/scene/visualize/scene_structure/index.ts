/**
 * scene_structure — 零变换透传 scene，供画布节点展示完整逻辑树结构。
 *
 * 与 scene_passthrough 相同：access 为 "tree" 时 dispatcher 传入 raw DataTree，
 * 原样回传，branches/paths/focus/version 全部保持不变。专属 UI 由前端
 * `scene_structure` nodeType 渲染器负责。
 */
export function sceneStructure(input: Record<string, unknown>): Record<string, unknown> {
  return { scene: input.scene }
}
