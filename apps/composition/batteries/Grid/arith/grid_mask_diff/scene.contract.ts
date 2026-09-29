import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridMaskDiff",
  contractVersion: "1.0.0",
  opId: "grid_mask_diff",
  label: "二值差集",
  nameEn: "GridMaskDiff",
  description: "1 where a is nonzero and b is zero. Same lattice required.",
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
