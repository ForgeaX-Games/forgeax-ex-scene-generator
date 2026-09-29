import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridMax",
  contractVersion: "1.0.0",
  opId: "grid_max",
  label: "逐格最大",
  nameEn: "GridMax",
  description: "Per-cell maximum. Same lattice or scalar.",
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
