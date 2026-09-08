import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'landmarkWatchtower',
  contractVersion: '1.0.0',
  opId: 'landmark_watchtower',
  description: 'Procedurally generate a village landmark watchtower/bell tower with battered stone plinth, shaft with slit windows, cantilevered timber gallery, and spire roof.',
  inputs: [
    { name: 'position', type: 'point2d', access: 'item', required: true, label: '塔楼位置' },
    { name: 'heightGrid', type: 'grid', access: 'item', label: '高度场' },
    { name: 'baseSize', type: 'number', access: 'item', defaultValue: 4.4, label: '基座尺寸', mode: 'parameter' },
    { name: 'height', type: 'number', access: 'item', defaultValue: 14.5, label: '塔楼总高', mode: 'parameter', control: true },
    { name: 'yaw', type: 'number', access: 'item', defaultValue: 0, label: '朝向', mode: 'parameter' },
  ],
  outputs: [
    { name: 'mesh', type: 'mesh', access: 'item', label: '塔楼Mesh' },
    { name: 'triangleCount', type: 'number', access: 'item', label: '三角面数' },
  ],
  deterministic: true,
})
