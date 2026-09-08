import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'splineSample',
  contractVersion: '1.0.0',
  opId: 'spline_sample',
  description: 'Sample control points into a dense centerline with tangents and per-sample widths. Curve is a value first.',
  inputs: [
    { name: 'points', type: 'point2d', access: 'list', required: true, label: '控制点' },
    { name: 'roadWidth', type: 'number', access: 'item', defaultValue: 3, label: '路宽', mode: 'parameter', control: true },
    { name: 'widths', type: 'number', access: 'list', label: '宽度剖面' },
    { name: 'flareStart', type: 'number', access: 'item', defaultValue: 0, label: '起点加宽', mode: 'parameter' },
    { name: 'tension', type: 'number', access: 'item', defaultValue: 0, label: '张力', mode: 'parameter' },
    { name: 'roundness', type: 'number', access: 'item', defaultValue: 1.3, label: '圆滑', mode: 'parameter' },
    { name: 'samplesPerSegment', type: 'number', access: 'item', defaultValue: 24, label: '每段采样', mode: 'parameter' },
  ],
  outputs: [
    { name: 'points', type: 'point2d', access: 'list', label: '中线点' },
    { name: 'tangents', type: 'point2d', access: 'list', label: '切线' },
    { name: 'yaw', type: 'number', access: 'list', label: '朝向' },
    { name: 'widths', type: 'number', access: 'list', label: '宽度' },
    { name: 'count', type: 'number', access: 'item', label: '点数' },
    { name: 'length', type: 'number', access: 'item', label: '弧长' },
  ],
  deterministic: true,
})
