import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'network3d',
  contractVersion: '1.0.0',
  opId: 'network3d',
  label: '曲线网3D',
  nameEn: 'Network3d',
  description: 'Create operating Geometry (network3d) from [x, y, z] nodes and { from, to, curve? } edges. No width, grade, or use.',
  inputs: [
    {
      name: 'nodes',
      type: 'point3d',
      runtimeType: 'geometry',
      access: 'list',
      required: true,
      defaultValue: [
        [0, 0, 0],
        [10, 0, 1],
        [10, 8, 2],
      ],
      label: '节点',
    },
    {
      name: 'edges',
      type: 'dict',
      runtimeType: 'dict',
      access: 'item',
      required: true,
      defaultValue: [
        { from: 0, to: 1 },
        { from: 1, to: 2 },
      ],
      label: '边',
    },
  ],
  outputs: [
    { name: 'geometry', type: 'network3d', runtimeType: 'geometry', access: 'item', label: '曲线网' },
  ],
  deterministic: true,
})
