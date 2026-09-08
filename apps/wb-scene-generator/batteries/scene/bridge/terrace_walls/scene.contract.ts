import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'terraceWalls',
  contractVersion: '1.0.0',
  opId: 'terrace_walls',
  description: 'Procedurally generate stone retaining walls along contour terrace edges.',
  inputs: [
    { name: 'heightGrid', type: 'grid', access: 'item', required: true, label: '高度场' },
    { name: 'terraceMask', type: 'grid', access: 'item', label: '梯田掩码' },
    { name: 'wallThickness', type: 'number', access: 'item', defaultValue: 0.45, label: '墙厚', mode: 'parameter' },
    { name: 'wallHeight', type: 'number', access: 'item', defaultValue: 1.4, label: '墙高', mode: 'parameter' },
    { name: 'roadPoints', type: 'point2d', access: 'list', label: '主道路线' },
    { name: 'ringPoints', type: 'point2d', access: 'list', label: '广场环路' },
    { name: 'trailPoints', type: 'point2d', access: 'list', label: '步道线' },
    { name: 'feederPoints', type: 'point2d', access: 'list', label: '山坡支路' },
    { name: 'millAccessPoints', type: 'point2d', access: 'list', label: '磨坊引道' },
    { name: 'riverPoints', type: 'point2d', access: 'list', label: '河流中心线' },
    { name: 'riverWidth', type: 'number', access: 'item', defaultValue: 8, label: '河流宽度', mode: 'parameter' },
    { name: 'plazaCenter', type: 'point2d', access: 'item', label: '广场中心' },
    { name: 'plazaRadius', type: 'number', access: 'item', defaultValue: 7.4, label: '广场半径', mode: 'parameter' },
    { name: 'towerPosition', type: 'point2d', access: 'item', label: '钟塔锚点' },
    { name: 'millPosition', type: 'point2d', access: 'item', label: '水车锚点' },
    { name: 'avoidPoints', type: 'point2d', access: 'list', label: '建筑避让点' },
    { name: 'clearance', type: 'number', access: 'item', defaultValue: 3.4, label: '结构净距', mode: 'parameter' },
  ],
  outputs: [
    { name: 'mesh', type: 'mesh', access: 'item', label: '挡土墙Mesh' },
    { name: 'triangleCount', type: 'number', access: 'item', label: '三角面数' },
  ],
  deterministic: true,
})
