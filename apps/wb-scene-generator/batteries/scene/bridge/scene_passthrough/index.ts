/**
 * scene_passthrough — 零变换透传。
 *
 * 端口 access 为 "tree"，dispatcher 把整棵 DataTree<scene> 不 fanout、不 normalize
 * 直接传入（见 dispatcher：access==='tree' 时使用 raw tree）。这里把输入原样作为输出
 * 返回，dispatcher 识别到返回值是 DataTree 后会整棵 pass-through，因此 branches/paths/
 * focus/version 全部保持不变。
 *
 * 注意：不要使用 parseScenePort / makeScenePort —— 那是为 access:"item" 的单 item
 * ScenePortValue 设计的，会改变数据形态；透传必须原样回传以保证结构零变换。
 */
export function scenePassthrough(input: Record<string, unknown>): Record<string, unknown> {
  return { scene: input.scene };
}
