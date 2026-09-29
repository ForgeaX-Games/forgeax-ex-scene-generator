import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'gridZonalMean',
  contractVersion: '1.0.0',
  opId: 'grid_zonal_mean',
  label: '区均值',
  nameEn: 'GridZonalMean',
  description: 'Replace each cell with the mean of its zone id. Zone 0 (background) is left unchanged. Same lattice or { error }.',
  inputs: [
    {
      name: 'grid',
      type: 'grid',
      runtimeType: 'grid',
      access: 'item',
      required: true,
      mode: 'value',
      description: 'Values to average per zone.',
      label: '网格',
    },
    {
      name: 'zones',
      type: 'grid',
      runtimeType: 'grid',
      access: 'item',
      required: true,
      mode: 'value',
      description: 'Integer zone ids from gridComponents. 0 is background.',
      label: '区号',
    },
  ],
  outputs: [
    {
      name: 'grid',
      type: 'grid',
      runtimeType: 'grid',
      access: 'item',
      description: 'Same lattice. Zone cells hold that zone mean.',
      label: '网格',
    },
  ],
  deterministic: true,
})
