import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'point3d',
  contractVersion: '1.0.0',
  opId: 'point3d',
  label: '点3D',
  nameEn: 'Point3d',
  description: 'Create operating Geometry (point3d) from authoring-metre x, y, z. World site; not hangable.',
  inputs: [
    { name: 'x', type: 'number', access: 'item', defaultValue: 0, mode: 'parameter', label: 'X' },
    { name: 'y', type: 'number', access: 'item', defaultValue: 0, mode: 'parameter', label: 'Y' },
    { name: 'z', type: 'number', access: 'item', defaultValue: 0, mode: 'parameter', label: 'Z' },
  ],
  outputs: [
    { name: 'geometry', type: 'point3d', runtimeType: 'geometry', access: 'item', label: '点' },
  ],
  deterministic: true,
})
