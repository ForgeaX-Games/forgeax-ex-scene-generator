import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridSharpen",
  contractVersion: "1.0.0",
  opId: "grid_sharpen",
  label: "反锐化",
  nameEn: "GridSharpen",
  description: "Unsharp mask. Radius is cells.",
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
      name: "amount",
      type: "number",
      access: "item",
      defaultValue: 1,
      mode: "parameter",
      label: "强度",
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
