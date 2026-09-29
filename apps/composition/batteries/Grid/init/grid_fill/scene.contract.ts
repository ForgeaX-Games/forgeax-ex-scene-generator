import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridFill",
  contractVersion: "1.0.0",
  opId: "grid_fill",
  label: "填充网格",
  nameEn: "GridFill",
  description: "Rewrite every cell of an existing Grid to a fill value. Shape stays the same.",
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
      name: "fill",
      type: "number",
      access: "item",
      defaultValue: 0,
      mode: "parameter",
      label: "填充",
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
