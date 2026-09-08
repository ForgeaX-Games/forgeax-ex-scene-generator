import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'villagePlaza',
  contractVersion: '1.0.0',
  opId: 'village_plaza',
  description: 'Procedurally generate a paved village marketplace plaza slab with stone edge curbs.',
  inputs: [
    { name: 'center', type: 'point2d', access: 'item', required: true, label: '广场中心' },
    { name: 'heightGrid', type: 'grid', access: 'item', label: '高度场' },
    { name: 'radius', type: 'number', access: 'item', defaultValue: 6.5, label: '广场半径', mode: 'parameter', control: true },
  ],
  outputs: [
    { name: 'mesh', type: 'mesh', access: 'item', label: '广场Mesh' },
    { name: 'triangleCount', type: 'number', access: 'item', label: '三角面数' },
  ],
  deterministic: true,
})
