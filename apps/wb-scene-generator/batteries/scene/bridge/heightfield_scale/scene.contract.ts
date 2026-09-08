import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'heightfieldScale',
  contractVersion: '1.0.0',
  opId: 'heightfield_scale',
  description: 'Scale and smooth discrete contour levels into continuous elevation heightfield with realistic vertical scale.',
  inputs: [
    { name: 'grid', type: 'grid', access: 'item', required: true, label: '输入网格' },
    { name: 'scale', type: 'number', access: 'item', defaultValue: 3.2, label: '高程倍率', mode: 'parameter', control: true },
    { name: 'base', type: 'number', access: 'item', defaultValue: 0, label: '基底海拔', mode: 'parameter', control: true },
    { name: 'smooth', type: 'boolean', access: 'item', defaultValue: true, label: '高斯平滑', mode: 'parameter' },
    { name: 'exponent', type: 'number', access: 'item', defaultValue: 1.0, label: '山脊指数', mode: 'parameter' },
  ],
  outputs: [
    { name: 'heightGrid', type: 'grid', access: 'item', label: '高度场' },
    { name: 'minElevation', type: 'number', access: 'item', label: '最低海拔' },
    { name: 'maxElevation', type: 'number', access: 'item', label: '最高海拔' },
  ],
  deterministic: true,
})
