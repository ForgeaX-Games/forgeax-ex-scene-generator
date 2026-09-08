import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'place',
  contractVersion: '1.0.0',
  opId: 'place',
  description: 'Graft a child scene at parent-local metres. SetParam write-back stays in child metres.',
  inputs: [
    { name: 'scene', type: 'scene', access: 'item', required: true, mode: 'value' },
    { name: 'child', type: 'scene', access: 'item', required: true, mode: 'value' },
    { name: 'name', type: 'string', access: 'item', defaultValue: 'placed', mode: 'parameter' },
    { name: 'x', type: 'number', access: 'item', defaultValue: 0, mode: 'parameter' },
    { name: 'y', type: 'number', access: 'item', defaultValue: 0, mode: 'parameter' },
    { name: 'z', type: 'number', access: 'item', defaultValue: 0, mode: 'parameter' },
  ],
  outputs: [
    { name: 'scene', type: 'scene', access: 'item' },
    { name: 'localOrigin', type: 'point2d', access: 'item' },
  ],
  deterministic: true,
})
