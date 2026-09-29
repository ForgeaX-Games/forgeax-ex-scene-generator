import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridMaskUnion",
  contractVersion: "1.0.0",
  opId: "grid_mask_union",
  label: "二值并集",
  nameEn: "GridMaskUnion",
  description: "1 where either Grid is nonzero. Same lattice required.",
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
