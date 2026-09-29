import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridErodeMorph",
  contractVersion: "1.0.0",
  opId: "grid_erode_morph",
  label: "形态学腐蚀",
  nameEn: "GridErodeMorph",
  description: "Morphological erode. Do not call erodeGrid.",
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
      name: "connectivity",
      type: "number",
      access: "item",
      defaultValue: 8,
      mode: "parameter",
      options: [
        "4",
        "8",
      ],
      label: "连通",
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
