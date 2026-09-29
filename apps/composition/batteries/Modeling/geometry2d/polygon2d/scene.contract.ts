import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "polygon2d",
  contractVersion: "1.0.0",
  opId: "polygon2d",
  label: "多边形",
  nameEn: "Polygon2d",
  description: "Create operating Geometry (polygon) from an authoring-metre ring. Optional holes. No use.",
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
        [10, 8],
        [0, 8],
      ],
      label: "外环",
    },
    {
      name: "holes",
      type: "point2d",
      runtimeType: "geometry",
      access: "tree",
      label: "洞",
    },
  ],
  outputs: [
    {
      name: "geometry",
      type: "polygon2d",
      runtimeType: "geometry",
      access: "item",
      label: "多边形",
    },
  ],
  deterministic: true,
})
