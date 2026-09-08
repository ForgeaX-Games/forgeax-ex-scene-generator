/**
 * scene_preview —— SceneSpec 预览电池（静态路的 urdf_preview / rig_preview 对应物）。
 *
 * 行为：接收 sceneSpec（来自 g_to_scene）原样透传到 sceneSpec 输出端口。前端 3D 预览器
 * 通过 live-sync 拉取本节点的 sceneSpec 输出，命中即切到 static 模式渲染
 * （逐条加载 <sha>.obj/.glb → 应用 origin/rpy/scale + 材质 → 组合成静态场景）。
 * 本电池只做 passthrough，不做编译/校验。
 */

export function scenePreview(input: Record<string, unknown>): Record<string, unknown> {
  const sceneSpec = input.sceneSpec ?? null;
  return { sceneSpec };
}

export default scenePreview;
