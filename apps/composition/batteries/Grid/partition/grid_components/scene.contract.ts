import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'gridComponents',
  contractVersion: '1.0.0',
  opId: 'grid_components',
  label: '连通域',
  nameEn: 'GridComponents',
  description: 'Label connected nonzero cells with integer ids. Background stays 0. Output is one Grid, not a list.',
  inputs: [
    {
      name: 'grid',
      type: 'grid',
      runtimeType: 'grid',
      access: 'item',
      required: true,
      mode: 'value',
      description: 'Nonzero cells are foreground.',
      label: '网格',
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
      description: 'Integer zone ids. 0 is background.',
      label: '区号',
    },
  ],
  deterministic: true,
})
