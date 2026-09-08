import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'gridToBoxes',
  contractVersion: '1.0.0',
  opId: 'grid_to_boxes',
  description: 'Extrude axis-aligned white boxes at point2d sites. Z comes from sample_height or a height grid; buildingHeight only changes the boxes.',
  inputs: [
    { name: 'points', type: 'point2d', access: 'list', required: true, label: '宅基点' },
    { name: 'buildingHeight', type: 'number', access: 'item', defaultValue: 3, label: '房高', mode: 'parameter', control: true },
    { name: 'z', type: 'number', access: 'list', label: '底面高度' },
    { name: 'heightGrid', type: 'grid', access: 'item', label: '高度场' },
    { name: 'footprint', type: 'number', access: 'item', defaultValue: 2, label: '底面边长', mode: 'parameter' },
    { name: 'cellSize', type: 'number', access: 'item', defaultValue: 1, label: '格尺寸', mode: 'parameter' },
  ],
  outputs: [
    { name: 'mesh', type: 'mesh', access: 'item', label: 'mesh' },
    { name: 'boxCount', type: 'number', access: 'item', label: '盒子数' },
  ],
  deterministic: true,
})
