import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'sampleHeight',
  contractVersion: '1.0.0',
  opId: 'sample_height',
  description: 'Sample a height grid at point2d locations so boxes sit on the hillside.',
  inputs: [
    { name: 'grid', type: 'grid', access: 'item', required: true, label: '高度场' },
    { name: 'points', type: 'point2d', access: 'list', required: true, label: '查询点' },
  ],
  outputs: [
    { name: 'heights', type: 'number', access: 'list', label: '高度' },
    { name: 'count', type: 'number', access: 'item', label: '点数' },
  ],
  deterministic: true,
})
