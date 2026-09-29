import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridSlope",
  contractVersion: "1.0.0",
  opId: "grid_slope",
  label: "坡",
  nameEn: "GridSlope",
  description: "Gradient magnitude in Δvalue / cell. Not degrees per metre.",
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
