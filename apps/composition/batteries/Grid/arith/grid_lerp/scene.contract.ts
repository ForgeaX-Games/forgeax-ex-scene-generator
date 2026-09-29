import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridLerp",
  contractVersion: "1.0.0",
  opId: "grid_lerp",
  label: "线性混合",
  nameEn: "GridLerp",
  description: "Lerp two same-lattice Grids. t is a number; weight is an optional per-cell Grid.",
  inputs: [
    {
      name: "a",
      type: "grid",
      runtimeType: "grid",
      access: "item",
      required: true,
      label: "A",
    },
    {
      name: "b",
      type: "grid",
      runtimeType: "grid",
      access: "item",
      required: true,
      label: "B",
    },
    {
      name: "t",
      type: "number",
      access: "item",
      defaultValue: 0.5,
      mode: "parameter",
      label: "T",
    },
    {
      name: "weight",
      type: "grid",
      runtimeType: "grid",
      access: "item",
      required: false,
      label: "权重",
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
