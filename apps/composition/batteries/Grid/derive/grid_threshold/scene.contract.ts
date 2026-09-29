import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridThreshold",
  contractVersion: "1.0.0",
  opId: "grid_threshold",
  label: "阈值",
  nameEn: "GridThreshold",
  description: "1 where grid >= value, else 0. A mask, not zone ids.",
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
      name: "value",
      type: "number",
      access: "item",
      defaultValue: 0.5,
      mode: "parameter",
      label: "阈值",
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
