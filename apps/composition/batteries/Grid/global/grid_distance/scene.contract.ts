import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'gridDistance',
  contractVersion: '1.0.0',
  opId: 'grid_distance',
  label: '格距',
  nameEn: 'GridDistance',
  description: 'Cell distance to the nearest nonzero seed. Optional mask is a wall where mask ≤ 0. Distance is cells, not metres.',
  inputs: [
    {
      name: 'seeds',
      type: 'grid',
      runtimeType: 'grid',
      access: 'item',
      required: true,
      mode: 'value',
      description: 'Nonzero cells are seeds (distance 0).',
      label: '种子',
    },
    {
      name: 'mask',
      type: 'grid',
      runtimeType: 'grid',
      access: 'item',
      required: false,
      mode: 'value',
      description: 'Walk only where mask > 0. Same lattice.',
      label: '可行走',
    },
    {
      name: 'connectivity',
      type: 'number',
      access: 'item',
      defaultValue: 8,
      mode: 'parameter',
      options: ['4', '8'],
      description: '4 or 8. Default 8.',
      label: '连通',
    },
  ],
  outputs: [
    {
      name: 'grid',
      type: 'grid',
      runtimeType: 'grid',
      access: 'item',
      description: 'Cell distance. Unreachable cells are 1e9.',
      label: '网格',
    },
  ],
  deterministic: true,
})
