import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridBBox",
  contractVersion: "1.0.0",
  opId: "grid_bbox",
  label: "非零包围盒",
  nameEn: "GridBBox",
  description: "Nonzero index bbox. Outputs numbers, not a Grid.",
  inputs: [
    {
      name: "grid",
      type: "grid",
      runtimeType: "grid",
      access: "item",
      required: true,
      label: "网格",
    },
  ],
  outputs: [
    {
      name: "columns",
      type: "number",
      access: "item",
      label: "列",
    },
    {
      name: "rows",
      type: "number",
      access: "item",
      label: "行",
    },
    {
      name: "col",
      type: "number",
      access: "item",
      label: "列起点",
    },
    {
      name: "row",
      type: "number",
      access: "item",
      label: "行起点",
    },
  ],
  deterministic: true,
})
