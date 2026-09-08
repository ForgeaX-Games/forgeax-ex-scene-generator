import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'strokeSweepMesh',
  contractVersion: '1.0.0',
  opId: 'stroke_sweep_mesh',
  description: 'Sweep a terrain-following road strip along a sampled centerline. Width from roadWidth or widths[].',
  inputs: [
    { name: 'points', type: 'point2d', access: 'list', required: true, label: '中线点' },
    { name: 'heightGrid', type: 'grid', access: 'item', label: '高度场' },
    { name: 'roadWidth', type: 'number', access: 'item', defaultValue: 3, label: '路宽', mode: 'parameter' },
    { name: 'widths', type: 'number', access: 'list', label: '宽度剖面' },
    { name: 'lift', type: 'number', access: 'item', defaultValue: 0, label: '抬升', mode: 'parameter' },
    { name: 'cellSize', type: 'number', access: 'item', defaultValue: 1, label: '格尺寸', mode: 'parameter' },
    { name: 'color', type: 'number', access: 'list', mode: 'parameter', label: '顶点色' },
  ],
  outputs: [
    { name: 'mesh', type: 'mesh', access: 'item', label: 'mesh' },
    { name: 'triangleCount', type: 'number', access: 'item', label: '三角数' },
  ],
  deterministic: true,
})
