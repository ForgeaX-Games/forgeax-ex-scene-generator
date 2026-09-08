import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'instantiatePlacements',
  contractVersion: '1.0.0',
  opId: 'instantiate_placements',
  description: 'Instantiate prototypes from a PlacementSet. x/y/z are authoring metres (+Y); the renderer flips Y once onto the terrain mesh.',
  inputs: [
    { name: 'scene', type: 'scene', access: 'item', required: true },
    { name: 'catalog', type: 'any', runtimeType: 'prototype-catalog', access: 'item', required: true, mode: 'value' },
    { name: 'placements', type: 'any', runtimeType: 'placement-set', access: 'item', required: true, mode: 'value' },
  ],
  outputs: [
    { name: 'scene', type: 'scene', access: 'item' },
    { name: 'count', type: 'number', access: 'item' },
  ],
  deterministic: true,
})
