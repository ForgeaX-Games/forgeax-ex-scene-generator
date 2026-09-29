import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridMedian",
  contractVersion: "1.0.0",
  opId: "grid_median",
  label: "中值",
  nameEn: "GridMedian",
  description: "Median filter. Radius is cells.",
  inputs: [
    {
      name: "grid",
      type: "grid",
      runtimeType: "grid",
      access: "item",
      required: true,
      label: "网格",
    },
    {
      name: "radius",
      type: "number",
      access: "item",
      defaultValue: 1,
      mode: "parameter",
      description: "Radius in cells, 1–16. Not metres.",
      label: "半径",
    },
    {
      name: "mask",
      type: "grid",
      runtimeType: "grid",
      access: "item",
      required: false,
      label: "遮罩",
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
