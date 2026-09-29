import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridAspect",
  contractVersion: "1.0.0",
  opId: "grid_aspect",
  label: "朝向",
  nameEn: "GridAspect",
  description: "Aspect in degrees [0, 360) from index-space gradients.",
  inputs: [
    {
      name: "grid",
      type: "grid",
      runtimeType: "grid",
      access: "item",
      required: true,
      label: "网格",
    },
  ],
  outputs: [
    {
      name: "grid",
      type: "grid",
      runtimeType: "grid",
      access: "item",
      label: "网格",
    },
  ],
  deterministic: true,
})
