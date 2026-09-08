import { defineGenerator } from '@forgeax/project-generator'

export const courtyardRegions = defineGenerator({
  id: 'courtyard-regions',
  description: 'RegionSet used only by the spatial-mismatch compile fixture.',
  inputs: {},
  outputs: { value: RegionSet },
  run() {
    return { value: { regions: [] } }
  },
})
