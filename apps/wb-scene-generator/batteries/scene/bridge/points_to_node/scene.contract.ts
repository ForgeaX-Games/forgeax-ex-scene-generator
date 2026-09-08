import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'pointsToNode',
  contractVersion: '1.1.0',
  opId: 'points_to_node',
  description: "Hang a point2d list as a guide node (content.schema='points').",
  inputs: [
    { name: 'name', type: 'string', access: 'item', required: true, label: '节点名', mode: 'parameter' },
    { name: 'points', type: 'point2d', access: 'list', required: true, label: '点列' },
    { name: 'style', type: 'string', access: 'item', required: false, label: '样式', mode: 'parameter' },
  ],
  outputs: [
    { name: 'scene', type: 'scene', access: 'item', label: 'scene' },
    { name: 'points', type: 'point2d', access: 'list', label: '点列' },
    { name: 'pointCount', type: 'number', access: 'item', label: '点数' },
  ],
  deterministic: true,
})
