import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'polygon3d',
  contractVersion: '1.0.0',
  opId: 'polygon3d',
  label: '多边形3D',
  nameEn: 'Polygon3d',
  description: 'Create operating Geometry (polygon3d) from an authoring-metre [x, y, z] ring. Optional holes. No use.',
  inputs: [
    {
      name: 'points',
      type: 'point3d',
      runtimeType: 'geometry',
      access: 'list',
      required: true,
      defaultValue: [
        [0, 0, 0],
        [10, 0, 0],
        [10, 8, 2],
        [0, 8, 2],
      ],
      label: '外环',
    },
    { name: 'holes', type: 'point3d', runtimeType: 'geometry', access: 'tree', label: '洞' },
  ],
  outputs: [
    { name: 'geometry', type: 'polygon3d', runtimeType: 'geometry', access: 'item', label: '多边形' },
  ],
  deterministic: true,
})
