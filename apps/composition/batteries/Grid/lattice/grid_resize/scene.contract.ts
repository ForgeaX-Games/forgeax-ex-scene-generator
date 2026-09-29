import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'gridResize',
  contractVersion: '1.0.0',
  opId: 'grid_resize',
  label: '改行列',
  nameEn: 'GridResize',
  description: 'Change lattice size. nearest or bilinear. Align tables before Arith. Not metres.',
  inputs: [
    {
      name: 'grid',
      type: 'grid',
      runtimeType: 'grid',
      access: 'item',
      required: true,
      mode: 'value',
      label: '网格',
    },
    {
      name: 'columns',
      type: 'number',
      access: 'item',
      required: true,
      mode: 'parameter',
      description: 'Output columns. Must be ≥ 1.',
      label: '列',
    },
    {
      name: 'rows',
      type: 'number',
      access: 'item',
      required: true,
      mode: 'parameter',
      description: 'Output rows. Must be ≥ 1.',
      label: '行',
    },
    {
      name: 'mode',
      type: 'string',
      access: 'item',
      defaultValue: 'bilinear',
      mode: 'parameter',
      options: ['nearest', 'bilinear'],
      description: 'Resample kernel.',
      label: '核',
    },
  ],
  outputs: [
    {
      name: 'grid',
      type: 'grid',
      runtimeType: 'grid',
      access: 'item',
      label: '网格',
    },
  ],
  deterministic: true,
})
