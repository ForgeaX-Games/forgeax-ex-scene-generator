import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'scopeSceneNode',
  contractVersion: '1.0.0',
  opId: 'scope_scene_node',
  description: 'Named grouping prim with no geometry. Parent for Ref or other children.',
  inputs: [
    { name: 'name', type: 'string', access: 'item', required: true, label: '节点名', mode: 'parameter' },
    { name: 'schema', type: 'string', access: 'item', defaultValue: 'scope', label: 'schema', mode: 'parameter' },
  ],
  outputs: [
    { name: 'scene', type: 'scene', access: 'item', label: 'scene' },
  ],
  deterministic: true,
})
