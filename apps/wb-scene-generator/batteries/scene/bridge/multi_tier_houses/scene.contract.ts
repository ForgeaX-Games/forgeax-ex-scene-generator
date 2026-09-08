import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'multiTierHouses',
  contractVersion: '1.0.0',
  opId: 'multi_tier_houses',
  description: 'Procedurally generate varied architectural white-box houses including cottages, 2-story townhouses with overhangs, and barns.',
  inputs: [
    { name: 'plots', type: 'list', access: 'item', label: '聚落宅基列表' },
    { name: 'points', type: 'point2d', access: 'list', label: '宅基点位' },
    { name: 'heightGrid', type: 'grid', access: 'item', label: '高度场' },
    { name: 'yaw', type: 'number', access: 'list', label: '建筑朝向' },
    { name: 'types', type: 'string', access: 'list', label: '建筑类型列表' },
  ],
  outputs: [
    { name: 'mesh', type: 'mesh', access: 'item', label: '建筑Mesh' },
    { name: 'count', type: 'number', access: 'item', label: '建筑数量' },
  ],
  deterministic: true,
})
