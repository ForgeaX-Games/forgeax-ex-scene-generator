import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridQuantize",
  contractVersion: "1.0.0",
  opId: "grid_quantize",
  label: "量化分层",
  nameEn: "GridQuantize",
  description: "Quantize to steps. Lattice terraces, not a geology Terrace SOP.",
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
      name: "steps",
      type: "number",
      access: "item",
      defaultValue: 4,
      mode: "parameter",
      label: "层数",
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
