import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridOutline",
  contractVersion: "1.0.0",
  opId: "grid_outline",
  label: "形态学轮廓",
  nameEn: "GridOutline",
  description: "Positive thickness is an inner ring; negative is an outer band.",
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
      name: "thickness",
      type: "number",
      access: "item",
      defaultValue: 1,
      mode: "parameter",
      label: "厚度",
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
