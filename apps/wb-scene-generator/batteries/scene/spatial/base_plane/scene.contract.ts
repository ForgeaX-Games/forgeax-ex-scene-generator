import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'basePlane',
  contractVersion: '1.0.0',
  opId: 'base_plane',
  description: 'Create a metre-space Plane. Control points stay in plane metres.',
  inputs: [
    { name: 'width', type: 'number', access: 'item', defaultValue: 2000, mode: 'parameter' },
    { name: 'height', type: 'number', access: 'item', defaultValue: 2000, mode: 'parameter' },
    { name: 'x', type: 'number', access: 'item', defaultValue: 0, mode: 'parameter' },
    { name: 'y', type: 'number', access: 'item', defaultValue: 0, mode: 'parameter' },
    { name: 'z', type: 'number', access: 'item', defaultValue: 0, mode: 'parameter' },
  ],
  outputs: [{ name: 'plane', type: 'any', runtimeType: 'plane', access: 'item' }],
  deterministic: true,
})
