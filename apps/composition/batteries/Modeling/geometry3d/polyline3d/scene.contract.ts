import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'polyline3d',
  contractVersion: '1.0.0',
  opId: 'polyline3d',
  label: '折线3D',
  nameEn: 'Polyline3d',
  description: 'Create operating Geometry (polyline3d) from authoring-metre [x, y, z] points. No width or use.',
  inputs: [
    {
      name: 'points',
      type: 'point3d',
      runtimeType: 'geometry',
      access: 'list',
      required: true,
      defaultValue: [
        [0, 0, 0],
        [10, 0, 2],
      ],
      label: '点',
    },
  ],
  outputs: [
    { name: 'geometry', type: 'polyline3d', runtimeType: 'geometry', access: 'item', label: '折线' },
  ],
  deterministic: true,
})
