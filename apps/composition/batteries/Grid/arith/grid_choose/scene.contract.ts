import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridChoose",
  contractVersion: "1.0.0",
  opId: "grid_choose",
  label: "按遮罩抽取",
  nameEn: "GridChoose",
  description: "Where mask > 0.5 take b, else a. Not a lerp.",
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
      required: true,
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
