import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'box',
  contractVersion: '1.0.0',
  opId: 'box',
  label: '盒子',
  nameEn: 'Box',
  description: 'Local Geometry kind mesh. Origin is the floor-centre contact. Pose it with transform or placeOnGround; do not write world vertices here.',
  inputs: [
    {
      name: 'width',
      type: 'number',
      access: 'item',
      defaultValue: 1,
      mode: 'parameter',
      description: 'Extent along +X (east), metres.',
      label: '宽',
    },
    {
      name: 'depth',
      type: 'number',
      access: 'item',
      defaultValue: 1,
      mode: 'parameter',
      description: 'Extent along +Y (south), metres.',
      label: '深',
    },
    {
      name: 'height',
      type: 'number',
      access: 'item',
      defaultValue: 1,
      mode: 'parameter',
      description: 'Extent along +Z (up), metres.',
      label: '高',
    },
  ],
  outputs: [
    {
      name: 'geometry',
      type: 'geometry',
      runtimeType: 'geometry',
      access: 'item',
      description: 'Hangable mesh in local metres. Floor centre is the origin.',
      label: '几何',
    },
  ],
  deterministic: true,
})
