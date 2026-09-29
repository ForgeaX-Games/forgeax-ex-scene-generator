import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "basePlane",
  contractVersion: "1.2.0",
  opId: "base_plane",
  label: "基准平面",
  nameEn: "BasePlane",
  description: "Create a metre-space Geometry plane from a top-left origin, width, and height. Default origin is [0, 0].",
  inputs: [
    {
      name: "origin",
      type: "point2d",
      runtimeType: "geometry",
      access: "item",
      defaultValue: [
        0,
        0,
      ],
      mode: "parameter",
      label: "左上角",
    },
    {
      name: "width",
      type: "number",
      access: "item",
      defaultValue: 10,
      mode: "parameter",
      label: "宽",
    },
    {
      name: "height",
      type: "number",
      access: "item",
      defaultValue: 10,
      mode: "parameter",
      label: "高",
    },
  ],
  outputs: [
    {
      name: "geometry",
      type: "geometry",
      runtimeType: "geometry",
      access: "item",
      label: "几何",
    },
  ],
  deterministic: true,
})
