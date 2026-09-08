import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'sceneChooseRuntime',
  contractVersion: '1.0.0',
  opId: 'scene_choose',
  description: 'Runtime node emitted by the Scene Script choose compiler builtin.',
  agentVisible: false,
  definitionScope: 'group-body',
  inputs: [
    { name: 'when', type: 'boolean', access: 'item', required: true, mode: 'value' },
    { name: 'then', type: 'any', access: 'item', required: true, mode: 'value' },
    { name: 'otherwise', type: 'any', access: 'item', required: true, mode: 'value' },
  ],
  outputs: [{ name: 'value', type: 'any', access: 'item' }],
  deterministic: true,
})
