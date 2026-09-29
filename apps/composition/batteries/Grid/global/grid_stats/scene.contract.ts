import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'gridStats',
  contractVersion: '1.0.0',
  opId: 'grid_stats',
  label: '场统计',
  nameEn: 'GridStats',
  description: 'Min / max / mean / sum / count / coverage. Optional mask counts only mask > 0. Outputs numbers, not a Grid.',
  inputs: [
    {
      name: 'grid',
      type: 'grid',
      runtimeType: 'grid',
      access: 'item',
      required: true,
      mode: 'value',
      description: 'Field to reduce.',
      label: '网格',
    },
    {
      name: 'mask',
      type: 'grid',
      runtimeType: 'grid',
      access: 'item',
      required: false,
      mode: 'value',
      description: 'Same lattice. Only cells with mask > 0 are counted.',
      label: '遮罩',
    },
  ],
  outputs: [
    { name: 'min', type: 'number', access: 'item', label: '最小' },
    { name: 'max', type: 'number', access: 'item', label: '最大' },
    { name: 'mean', type: 'number', access: 'item', label: '均值' },
    { name: 'sum', type: 'number', access: 'item', label: '和' },
    { name: 'count', type: 'number', access: 'item', label: '格数' },
    { name: 'coverage', type: 'number', access: 'item', description: 'count / (rows × columns)', label: '覆盖' },
  ],
  deterministic: true,
})
