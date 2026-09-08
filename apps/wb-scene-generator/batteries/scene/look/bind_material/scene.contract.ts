import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'bindMaterial',
  contractVersion: '1.0.0',
  opId: 'bind_material',
  description: 'Bind a .material.ts look onto a mesh (PreviewSurface baseColor → mesh.color / colors).',
  inputs: [
    { name: 'mesh', type: 'mesh', access: 'item', required: true },
    { name: 'material', type: 'any', access: 'item', required: true },
  ],
  outputs: [
    { name: 'mesh', type: 'mesh', access: 'item' },
    { name: 'material', type: 'any', access: 'item' },
  ],
  deterministic: true,
})
