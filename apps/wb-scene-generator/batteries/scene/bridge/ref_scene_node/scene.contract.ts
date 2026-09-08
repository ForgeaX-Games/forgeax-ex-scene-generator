import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'refSceneNode',
  contractVersion: '1.0.0',
  opId: 'ref_scene_node',
  description: 'Hang another .scene.ts as a Ref prim. Mesh is optional; missing geometry keeps the Ref.',
  inputs: [
    { name: 'name', type: 'string', access: 'item', required: true, label: '节点名', mode: 'parameter' },
    { name: 'module', type: 'string', access: 'item', required: true, label: '模块路径', mode: 'parameter' },
    { name: 'exportName', type: 'string', access: 'item', label: '导出名', mode: 'parameter' },
    { name: 'mesh', type: 'mesh', access: 'item', label: 'mesh' },
  ],
  outputs: [
    { name: 'scene', type: 'scene', access: 'item', label: 'scene' },
    { name: 'triangleCount', type: 'number', access: 'item', label: '三角数' },
  ],
  deterministic: true,
})
