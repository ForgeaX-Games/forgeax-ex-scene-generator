/**
 * rig_preview —— RigSpec 预览电池（角色路的 urdf_preview 对应物）。
 *
 * 行为：接收 rigSpec（来自 g_to_rig）原样透传到 rigSpec 输出端口。前端 3D 预览器
 * 通过 live-sync 拉取本节点的 rigSpec 输出，命中即切到 character 模式渲染
 * （加载 <sha>.glb + 从骨架测地体素绑定求权重 → SkinnedMesh + Skeleton）。
 * 本电池只做 passthrough，不做编译/校验。
 */

export function rigPreview(input: Record<string, unknown>): Record<string, unknown> {
  const rigSpec = input.rigSpec ?? null;
  return { rigSpec };
}

export default rigPreview;
