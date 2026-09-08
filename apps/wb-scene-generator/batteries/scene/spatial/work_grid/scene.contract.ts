import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'workGrid',
  contractVersion: '1.0.0',
  opId: 'work_grid',
  description: 'Sample a Plane at a cell size. Changing cellSize does not move Control metres.',
  inputs: [
    { name: 'plane', type: 'any', runtimeType: 'plane', access: 'item', required: true, mode: 'value' },
    { name: 'cellSize', type: 'number', access: 'item', defaultValue: 1, mode: 'parameter' },
  ],
  outputs: [{ name: 'grid', type: 'any', runtimeType: 'work-grid', access: 'item' }],
  deterministic: true,
})
