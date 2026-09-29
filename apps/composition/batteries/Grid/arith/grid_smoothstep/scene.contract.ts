import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridSmoothstep",
  contractVersion: "1.0.0",
  opId: "grid_smoothstep",
  label: "平滑阶跃",
  nameEn: "GridSmoothstep",
  description: "Hermite smoothstep between edge0 and edge1.",
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
      name: "edge0",
      type: "number",
      access: "item",
      defaultValue: 0,
      mode: "parameter",
      label: "边0",
    },
    {
      name: "edge1",
      type: "number",
      access: "item",
      defaultValue: 1,
      mode: "parameter",
      label: "边1",
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
