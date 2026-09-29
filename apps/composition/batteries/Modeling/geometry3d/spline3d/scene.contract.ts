import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'spline3d',
  contractVersion: '1.0.0',
  opId: 'spline3d',
  label: '样条3D',
  nameEn: 'Spline3d',
  description: 'Create operating Geometry (spline3d) from authoring-metre [x, y, z] control points. No width or use.',
  inputs: [
    {
      name: 'points',
      type: 'point3d',
      runtimeType: 'geometry',
      access: 'list',
      required: true,
      defaultValue: [
        [0, 0, 0],
        [4, 6, 3],
        [10, 0, 1],
      ],
      label: '控制点',
    },
    { name: 'degree', type: 'number', access: 'item', defaultValue: 3, mode: 'parameter', label: '次数' },
  ],
  outputs: [
    { name: 'geometry', type: 'spline3d', runtimeType: 'geometry', access: 'item', label: '样条' },
  ],
  deterministic: true,
})
