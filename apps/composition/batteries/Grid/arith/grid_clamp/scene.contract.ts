import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridClamp",
  contractVersion: "1.0.0",
  opId: "grid_clamp",
  label: "夹取",
  nameEn: "GridClamp",
  description: "Clamp every cell to [min, max].",
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
      name: "min",
      type: "number",
      access: "item",
      defaultValue: 0,
      mode: "parameter",
      label: "最小",
    },
    {
      name: "max",
      type: "number",
      access: "item",
      defaultValue: 1,
      mode: "parameter",
      label: "最大",
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
