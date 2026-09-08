import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'materialLook',
  contractVersion: '1.0.0',
  opId: 'material_look',
  description: 'Material prim with a PreviewSurface terminal. Scene modules bind this look; they do not inline shaders.',
  inputs: [
    { name: 'id', type: 'string', access: 'item', required: true, mode: 'parameter' },
    { name: 'surface', type: 'any', access: 'item', required: true },
  ],
  outputs: [
    { name: 'material', type: 'any', access: 'item', label: 'material' },
  ],
  deterministic: true,
})
