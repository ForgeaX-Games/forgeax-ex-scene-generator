import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'prototypeCatalog',
  contractVersion: '1.0.0',
  opId: 'prototype_catalog',
  description: 'Collect named Scene prototypes for later placement instantiation.',
  inputs: [
    { name: 'keys', type: 'string', access: 'list', mode: 'parameter', required: true },
    { name: 'prototypes', type: 'scene', access: 'list', required: true, mode: 'value' },
  ],
  outputs: [
    { name: 'catalog', type: 'any', runtimeType: 'prototype-catalog', access: 'item' },
    { name: 'keys', type: 'string', access: 'list' },
  ],
  deterministic: true,
})
