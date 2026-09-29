import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridBlur",
  contractVersion: "1.0.0",
  opId: "grid_blur",
  label: "模糊",
  nameEn: "GridBlur",
  description: "Box or gaussian blur. Radius is cells, not metres.",
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
      name: "radius",
      type: "number",
      access: "item",
      defaultValue: 1,
      mode: "parameter",
      description: "Radius in cells, 1–16. Not metres.",
      label: "半径",
    },
    {
      name: "kind",
      type: "string",
      access: "item",
      defaultValue: "box",
      mode: "parameter",
      options: [
        "box",
        "gaussian",
      ],
      label: "核",
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
