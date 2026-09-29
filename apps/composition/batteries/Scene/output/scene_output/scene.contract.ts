import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "sceneOutput",
  contractVersion: "1.0.0",
  opId: "scene_output",
  label: "场景输出",
  nameEn: "SceneOutput",
  description: "Assemble the complete SceneTree. Persist remains .scene.ts. Missing this call is a warning, not an authoring block.",
  canvas: {
    nodeType: "scene_sink",
    hideOutputs: true,
  },
  inputs: [
    {
      name: "scene",
      type: "scene",
      required: true,
      description: "要同步到渲染器的 scene；focus 子树内每个带 cells 的节点产生一个 voxel 图层",
      label: "scene",
    },
  ],
  outputs: [
    {
      name: "layers",
      type: "voxel_layers",
      description: "voxel 图层列表（DFS 展平 focus 子树）；UI 隐藏，但通过 NODE_OUTPUT 进入渲染器 layers 桶",
      label: "layers",
    },
    {
      name: "names",
      type: "name_list",
      description: "与 layers 对齐的名称清单（id/name/type；name 优先 attributes.asset_name，type 优先 attributes.asset_type）",
      label: "names",
    },
    {
      name: "scene",
      type: "scene",
      description: "输出完整的场景图端口值（带 graph 与 focus）。",
      label: "scene",
    },
  ],
  deterministic: true,
})
