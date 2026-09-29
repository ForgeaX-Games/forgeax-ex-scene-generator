import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridCurvature",
  contractVersion: "1.0.0",
  opId: "grid_curvature",
  label: "曲率",
  nameEn: "GridCurvature",
  description: "4-neighbour Laplacian in index space.",
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
