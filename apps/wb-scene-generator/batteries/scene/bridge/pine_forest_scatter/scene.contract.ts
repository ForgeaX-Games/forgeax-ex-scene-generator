import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'pineForestScatter',
  contractVersion: '1.0.0',
  opId: 'pine_forest_scatter',
  description: 'Procedurally scatter low-poly white-box pine trees across forest zones and hillside slopes.',
  inputs: [
    { name: 'heightGrid', type: 'grid', access: 'item', required: true, label: '高度场' },
    { name: 'forestMask', type: 'grid', access: 'item', label: '森林掩码' },
    { name: 'count', type: 'number', access: 'item', defaultValue: 24, label: '树木数量', mode: 'parameter', control: true },
    { name: 'seed', type: 'number', access: 'item', defaultValue: 42, label: '随机种子', mode: 'parameter', control: true },
    { name: 'minHeight', type: 'number', access: 'item', defaultValue: 3.5, label: '最小树高', mode: 'parameter' },
    { name: 'maxHeight', type: 'number', access: 'item', defaultValue: 6.5, label: '最大树高', mode: 'parameter' },
    { name: 'avoidPoints', type: 'point2d', access: 'list', label: '避让点' },
    { name: 'avoidRadius', type: 'number', access: 'item', defaultValue: 3.6, label: '避让半径', mode: 'parameter' },
    { name: 'plazaCenter', type: 'point2d', access: 'item', label: '广场中心' },
    { name: 'plazaRadius', type: 'number', access: 'item', defaultValue: 7.4, label: '广场半径', mode: 'parameter' },
  ],
  outputs: [
    { name: 'mesh', type: 'mesh', access: 'item', label: '植被Mesh' },
    { name: 'points', type: 'point2d', access: 'list', label: '植被点位' },
    { name: 'triangleCount', type: 'number', access: 'item', label: '三角面数' },
  ],
  deterministic: true,
})
