import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'extractPlane',
  contractVersion: '1.0.0',
  opId: 'extract_plane',
  description: 'Extract or construct a child-local Plane in metres.',
  inputs: [
    { name: 'width', type: 'number', access: 'item', defaultValue: 600, mode: 'parameter' },
    { name: 'height', type: 'number', access: 'item', defaultValue: 450, mode: 'parameter' },
    { name: 'x', type: 'number', access: 'item', defaultValue: 0, mode: 'parameter' },
    { name: 'y', type: 'number', access: 'item', defaultValue: 0, mode: 'parameter' },
    { name: 'plane', type: 'any', runtimeType: 'plane', access: 'item', mode: 'value' },
  ],
  outputs: [{ name: 'plane', type: 'any', runtimeType: 'plane', access: 'item' }],
  deterministic: true,
})
