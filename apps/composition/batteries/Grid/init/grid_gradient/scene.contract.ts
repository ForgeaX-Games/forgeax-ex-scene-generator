import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridGradient",
  contractVersion: "1.0.0",
  opId: "grid_gradient",
  label: "斜坡网格",
  nameEn: "GridGradient",
  description: "Create a valued Grid with a row, column, or radial ramp in index space (0–1).",
  inputs: [
    {
      name: "columns",
      type: "number",
      access: "item",
      defaultValue: 16,
      mode: "parameter",
      label: "列",
    },
    {
      name: "rows",
      type: "number",
      access: "item",
      defaultValue: 16,
      mode: "parameter",
      label: "行",
    },
    {
      name: "kind",
      type: "string",
      access: "item",
      defaultValue: "row",
      mode: "parameter",
      options: [
        "row",
        "col",
        "radial",
      ],
      label: "方向",
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
