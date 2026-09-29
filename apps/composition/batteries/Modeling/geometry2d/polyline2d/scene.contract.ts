import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "polyline2d",
  contractVersion: "1.0.0",
  opId: "polyline2d",
  label: "折线",
  nameEn: "Polyline2d",
  description: "Create operating Geometry (polyline) from authoring-metre points. No width or use.",
  inputs: [
    {
      name: "points",
      type: "point2d",
      runtimeType: "geometry",
      access: "list",
      required: true,
      defaultValue: [
        [0, 0],
        [10, 0],
      ],
      label: "点",
    },
  ],
  outputs: [
    {
      name: "geometry",
      type: "polyline2d",
      runtimeType: "geometry",
      access: "item",
      label: "折线",
    },
  ],
  deterministic: true,
})
