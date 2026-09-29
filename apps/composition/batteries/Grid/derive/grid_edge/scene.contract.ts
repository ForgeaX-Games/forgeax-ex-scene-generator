import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridEdge",
  contractVersion: "1.0.0",
  opId: "grid_edge",
  label: "边缘带",
  nameEn: "GridEdge",
  description: "Max absolute 4-neighbour difference. Prefer gridOutline for a binary ring.",
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
