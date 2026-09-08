import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'previewSurface',
  contractVersion: '1.0.0',
  opId: 'preview_surface',
  description: 'UsdShade-style PreviewSurface: baseColor, roughness, metallic.',
  inputs: [
    { name: 'baseColor', type: 'any', access: 'item', label: 'baseColor' },
    { name: 'r', type: 'number', access: 'item', defaultValue: 0.72, mode: 'parameter' },
    { name: 'g', type: 'number', access: 'item', defaultValue: 0.72, mode: 'parameter' },
    { name: 'b', type: 'number', access: 'item', defaultValue: 0.7, mode: 'parameter' },
    { name: 'roughness', type: 'number', access: 'item', defaultValue: 0.7, mode: 'parameter', control: true },
    { name: 'metallic', type: 'number', access: 'item', defaultValue: 0.02, mode: 'parameter' },
  ],
  outputs: [
    { name: 'surface', type: 'any', access: 'item', label: 'surface' },
  ],
  deterministic: true,
})
