import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'heightfieldMesh',
  contractVersion: '1.0.0',
  opId: 'heightfield_mesh',
  label: '高度场织网',
  nameEn: 'HeightfieldMesh',
  description: 'Weave a Heightfield packet into Geometry kind mesh. Reads plane + height. Vertex Z and planar UV (0–1 over the plane) use the same sampleHeight bilinear. Mask does not punch holes. Hang the mesh with sceneNode.',
  inputs: [
    {
      name: 'heightfield',
      type: 'heightfield',
      runtimeType: 'heightfield',
      access: 'item',
      required: true,
      mode: 'value',
      description: 'Heightfield packet. Lattice and pose come from the packet.',
      label: '高度场',
    },
  ],
  outputs: [
    {
      name: 'geometry',
      type: 'geometry',
      runtimeType: 'geometry',
      access: 'item',
      description: 'Geometry kind mesh in authoring metres. uvs are 0–1 over the packet plane, matching sampleHeight. Feed sceneNode.',
      label: '几何',
    },
  ],
  deterministic: true,
})
