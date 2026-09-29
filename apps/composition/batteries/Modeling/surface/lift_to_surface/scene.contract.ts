import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: 'liftToSurface',
  contractVersion: '1.0.0',
  opId: 'lift_to_surface',
  label: '升到表面',
  nameEn: 'LiftToSurface',
  description: 'Lift 2D operating Geometry onto a Heightfield with a vertical sample (same as sampleHeight). Preserves network node indices. Edges densify by XY arc length. Off-field is { error }.',
  inputs: [
    {
      name: 'geometry',
      type: 'geometry',
      runtimeType: 'geometry',
      access: 'item',
      required: true,
      mode: 'value',
      description: '2D operating Geometry. point2d / polyline / spline / polygon / network.',
      label: '几何',
    },
    {
      name: 'surface',
      type: 'heightfield',
      runtimeType: 'heightfield',
      access: 'item',
      required: true,
      mode: 'value',
      description: 'Heightfield packet. UV comes from the packet plane.',
      label: '表面',
    },
  ],
  outputs: [
    {
      name: 'geometry',
      type: 'geometry',
      runtimeType: 'geometry',
      access: 'item',
      description: 'Matching 3D operating Geometry sitting on the Heightfield.',
      label: '几何',
    },
  ],
  deterministic: true,
})
