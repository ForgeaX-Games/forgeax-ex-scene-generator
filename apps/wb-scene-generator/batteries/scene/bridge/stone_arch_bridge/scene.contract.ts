import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'stoneArchBridge',
  contractVersion: '1.0.0',
  opId: 'stone_arch_bridge',
  description: 'Procedurally generate a stone arch bridge spanning a river, with arch soffit, paved deck, abutments, and stone parapets.',
  inputs: [
    { name: 'start', type: 'point2d', access: 'item', required: true, label: '桥头起点' },
    { name: 'end', type: 'point2d', access: 'item', required: true, label: '桥头终点' },
    { name: 'heightGrid', type: 'grid', access: 'item', label: '高度场' },
    { name: 'width', type: 'number', access: 'item', defaultValue: 3.8, label: '桥宽', mode: 'parameter', control: true },
    { name: 'archHeight', type: 'number', access: 'item', defaultValue: 1.8, label: '拱高', mode: 'parameter', control: true },
    { name: 'parapetHeight', type: 'number', access: 'item', defaultValue: 0.85, label: '护栏高', mode: 'parameter' },
  ],
  outputs: [
    { name: 'mesh', type: 'mesh', access: 'item', label: '桥梁Mesh' },
    { name: 'triangleCount', type: 'number', access: 'item', label: '三角面数' },
  ],
  deterministic: true,
})
