import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'heightfieldSetMask',
  contractVersion: '1.0.0',
  opId: 'heightfield_set_mask',
  label: '换高度场遮罩',
  nameEn: 'HeightfieldSetMask',
  description: 'Replace Heightfield.mask only. Same lattice or { error }. Keeps geometry, height, and attributes. Default paints a red halo when the new mask is not all 1s.',
  inputs: [
    {
      name: 'heightfield',
      type: 'heightfield',
      runtimeType: 'heightfield',
      access: 'item',
      required: true,
      mode: 'value',
      description: 'Heightfield packet to rewrite.',
      label: '高度场',
    },
    {
      name: 'mask',
      type: 'grid',
      runtimeType: 'grid',
      access: 'item',
      required: true,
      mode: 'value',
      description: 'Control Grid on the same lattice as the packet.',
      label: '遮罩',
    },
  ],
  outputs: [
    {
      name: 'heightfield',
      type: 'heightfield',
      runtimeType: 'heightfield',
      access: 'item',
      description: 'Same packet with the new mask. Not a mesh.',
      label: '高度场',
    },
  ],
  deterministic: true,
})
