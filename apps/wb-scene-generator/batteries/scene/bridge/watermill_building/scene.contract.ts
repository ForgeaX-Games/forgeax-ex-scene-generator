import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'watermillBuilding',
  contractVersion: '1.0.0',
  opId: 'watermill_building',
  description: 'Procedurally generate a riverfront watermill building with 2-story milling house and rotating waterwheel.',
  inputs: [
    { name: 'position', type: 'point2d', access: 'item', required: true, label: '磨坊位置' },
    { name: 'heightGrid', type: 'grid', access: 'item', label: '高度场' },
    { name: 'yaw', type: 'number', access: 'item', defaultValue: 0, label: '朝向', mode: 'parameter' },
  ],
  outputs: [
    { name: 'mesh', type: 'mesh', access: 'item', label: '磨坊Mesh' },
    { name: 'triangleCount', type: 'number', access: 'item', label: '三角面数' },
  ],
  deterministic: true,
})
