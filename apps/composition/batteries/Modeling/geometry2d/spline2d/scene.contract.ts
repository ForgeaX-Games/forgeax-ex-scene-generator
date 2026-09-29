import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "spline2d",
  contractVersion: "1.0.0",
  opId: "spline2d",
  label: "样条",
  nameEn: "Spline2d",
  description: "Create operating Geometry (spline) from authoring-metre control points. No width or use.",
  inputs: [
    {
      name: "points",
      type: "point2d",
      runtimeType: "geometry",
      access: "list",
      required: true,
      defaultValue: [
        [0, 0],
        [4, 6],
        [10, 0],
      ],
      label: "控制点",
    },
    {
      name: "degree",
      type: "number",
      access: "item",
      defaultValue: 3,
      mode: "parameter",
      label: "次数",
    },
  ],
  outputs: [
    {
      name: "geometry",
      type: "spline2d",
      runtimeType: "geometry",
      access: "item",
      label: "样条",
    },
  ],
  deterministic: true,
})
