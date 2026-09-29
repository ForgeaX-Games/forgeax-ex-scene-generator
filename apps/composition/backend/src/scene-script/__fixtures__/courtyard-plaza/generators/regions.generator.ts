import { defineGenerator } from '@forgeax/project-generator'

export const courtyardRegions = defineGenerator({
  id: 'courtyard-regions',
  description: 'Spatial-mismatch compile fixture.',
  inputs: {},
  outputs: { value: Any },
  run() {
    return { value: { regions: [] } }
  },
})
