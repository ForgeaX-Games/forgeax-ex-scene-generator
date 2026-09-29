import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridRangeSelect",
  contractVersion: "1.0.0",
  opId: "grid_range_select",
  label: "区间选择",
  nameEn: "GridRangeSelect",
  description: "1 where min <= grid <= max.",
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
      name: "min",
      type: "number",
      access: "item",
      defaultValue: 0,
      mode: "parameter",
      label: "最小",
    },
    {
      name: "max",
      type: "number",
      access: "item",
      defaultValue: 1,
      mode: "parameter",
      label: "最大",
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
