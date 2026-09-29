import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridAbs",
  contractVersion: "1.0.0",
  opId: "grid_abs",
  label: "绝对值",
  nameEn: "GridAbs",
  description: "Per-cell absolute value.",
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
