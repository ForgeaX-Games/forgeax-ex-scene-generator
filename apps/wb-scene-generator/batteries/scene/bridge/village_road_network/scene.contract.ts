import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'villageRoadNetwork',
  contractVersion: '1.2.0',
  opId: 'village_road_network',
  description: 'Generate a plaza-centric village road graph as segmented surface-draped curves: civic ring, west/east arterial spokes, mill access, hillside feeder and trail, plus one unified road mesh and landmark anchors from the same hub.',
  inputs: [
    { name: 'plazaCenter', type: 'point2d', access: 'item', required: true, label: '广场中心' },
    { name: 'plazaRadius', type: 'number', access: 'item', defaultValue: 7.4, label: '广场半径', mode: 'parameter', control: true },
    { name: 'riverPoints', type: 'point2d', access: 'list', label: '河流中心线' },
    { name: 'heightGrid', type: 'grid', access: 'item', label: '高度场' },
    { name: 'riverWidth', type: 'number', access: 'item', defaultValue: 8, label: '河流宽度', mode: 'parameter' },
    { name: 'seed', type: 'number', access: 'item', defaultValue: 27, label: '随机种子', mode: 'parameter' },
  ],
  outputs: [
    { name: 'arterialPoints', type: 'point2d', access: 'list', label: '主干道中心线' },
    { name: 'ringPoints', type: 'point2d', access: 'list', label: '广场环路' },
    { name: 'trailPoints', type: 'point2d', access: 'list', label: '南向步道' },
    { name: 'feederPoints', type: 'point2d', access: 'list', label: '山坡支路' },
    { name: 'millAccessPoints', type: 'point2d', access: 'list', label: '磨坊引道' },
    { name: 'towerPosition', type: 'point2d', access: 'item', label: '钟塔锚点' },
    { name: 'millPosition', type: 'point2d', access: 'item', label: '水车锚点' },
    { name: 'millYaw', type: 'number', access: 'item', label: '水车朝向' },
    { name: 'bridgeStart', type: 'point2d', access: 'item', label: '桥北端' },
    { name: 'bridgeEnd', type: 'point2d', access: 'item', label: '桥南端' },
    { name: 'plazaCenter', type: 'point2d', access: 'item', label: '广场中心' },
    { name: 'plazaRadius', type: 'number', access: 'item', label: '广场半径' },
    { name: 'mesh', type: 'mesh', access: 'item', label: '路网Mesh' },
  ],
  deterministic: true,
})
