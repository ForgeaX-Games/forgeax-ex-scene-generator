import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'gabledHouses',
  contractVersion: '1.0.0',
  opId: 'gabled_houses',
  description: 'Extrude architectural white-model village houses with gabled pitched roofs and foundation plinths at point2d sites.',
  inputs: [
    { name: 'points', type: 'point2d', access: 'list', required: true, label: '宅基点' },
    { name: 'buildingHeight', type: 'number', access: 'item', defaultValue: 3.2, label: '建筑高度', mode: 'parameter', control: true },
    { name: 'roofHeight', type: 'number', access: 'item', defaultValue: 1.8, label: '屋顶高度', mode: 'parameter', control: true },
    { name: 'footprint', type: 'number', access: 'item', defaultValue: 3, label: '建筑面宽', mode: 'parameter', control: true },
    { name: 'depth', type: 'number', access: 'item', defaultValue: 2.5, label: '建筑进深', mode: 'parameter', control: true },
    { name: 'yaw', type: 'number', access: 'list', label: '朝向' },
    { name: 'z', type: 'number', access: 'list', label: '底面高度' },
    { name: 'heightGrid', type: 'grid', access: 'item', label: '高度场' },
    { name: 'cellSize', type: 'number', access: 'item', defaultValue: 1, label: '格尺寸', mode: 'parameter' },
  ],
  outputs: [
    { name: 'mesh', type: 'mesh', access: 'item', label: 'mesh' },
    { name: 'count', type: 'number', access: 'item', label: '建筑数' },
  ],
  deterministic: true,
})
