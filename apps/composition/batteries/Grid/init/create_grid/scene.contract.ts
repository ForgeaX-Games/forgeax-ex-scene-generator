import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "createGrid",
  contractVersion: "1.0.0",
  opId: "create_grid",
  label: "创建网格",
  nameEn: "CreateGrid",
  description: "Create a valued number[][] grid from columns, rows, and a fill value. No Geometry required.",
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
