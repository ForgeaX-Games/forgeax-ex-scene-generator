import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'alpineSceneProps',
  contractVersion: '1.1.0',
  opId: 'alpine_scene_props',
  description: 'Procedurally generate varied storytelling scene props including mountain summit crosses, trail cairns, scree boulders, river fishing piers, road junction signposts, street lanterns, water troughs, pasture fences, and haystacks.',
  inputs: [
    { name: 'heightGrid', type: 'grid', access: 'item', required: true, label: '高度场' },
    { name: 'slopeGrid', type: 'grid', access: 'item', label: '坡度场' },
    { name: 'terraceMask', type: 'grid', access: 'item', label: '梯田掩码' },
    { name: 'forestMask', type: 'grid', access: 'item', label: '森林掩码' },
    { name: 'roadPoints', type: 'point2d', access: 'list', label: '主道路线' },
    { name: 'ringPoints', type: 'point2d', access: 'list', label: '广场环路' },
    { name: 'trailPoints', type: 'point2d', access: 'list', label: '山道步道' },
    { name: 'feederPoints', type: 'point2d', access: 'list', label: '山坡支路' },
    { name: 'millAccessPoints', type: 'point2d', access: 'list', label: '磨坊引道' },
    { name: 'riverPoints', type: 'point2d', access: 'list', label: '河流中心线' },
    { name: 'plazaCenter', type: 'point2d', access: 'item', label: '广场中心' },
    { name: 'plazaRadius', type: 'number', access: 'item', defaultValue: 7.4, mode: 'parameter', label: '广场半径' },
    { name: 'bridgeStart', type: 'point2d', access: 'item', label: '桥头起点' },
    { name: 'bridgeEnd', type: 'point2d', access: 'item', label: '桥头终点' },
    { name: 'towerPosition', type: 'point2d', access: 'item', label: '钟塔锚点' },
    { name: 'millPosition', type: 'point2d', access: 'item', label: '水车锚点' },
    { name: 'avoidPoints', type: 'point2d', access: 'list', label: '建筑避让点' },
    { name: 'riverWidth', type: 'number', access: 'item', defaultValue: 8, mode: 'parameter', label: '河流宽度' },
    { name: 'seed', type: 'number', access: 'item', defaultValue: 42, mode: 'parameter', control: true, label: '随机种子' },
  ],
  outputs: [
    { name: 'mesh', type: 'mesh', access: 'item', label: '道具Mesh' },
    { name: 'triangleCount', type: 'number', access: 'item', label: '三角面数' },
  ],
  deterministic: true,
})
