import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "point2d",
  contractVersion: "1.0.0",
  opId: "point2d",
  label: "点",
  nameEn: "Point2d",
  description: "Create operating Geometry (point2d) from authoring-metre x and y. Plan site; no z required.",
  inputs: [
    {
      name: "x",
      type: "number",
      access: "item",
      defaultValue: 0,
      mode: "parameter",
      label: "X",
    },
    {
      name: "y",
      type: "number",
      access: "item",
      defaultValue: 0,
      mode: "parameter",
      label: "Y",
    },
  ],
  outputs: [
    {
      name: "geometry",
      type: "point2d",
      runtimeType: "geometry",
      access: "item",
      label: "点",
    },
  ],
  deterministic: true,
})
