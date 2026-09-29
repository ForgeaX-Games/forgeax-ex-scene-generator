import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridSub",
  contractVersion: "1.0.0",
  opId: "grid_sub",
  label: "减",
  nameEn: "GridSub",
  description: "Subtract a Grid or number from a Grid. Same lattice or scalar.",
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
      required: false,
      label: "B",
    },
    {
      name: "value",
      type: "number",
      access: "item",
      defaultValue: 0,
      mode: "parameter",
      label: "数值",
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
