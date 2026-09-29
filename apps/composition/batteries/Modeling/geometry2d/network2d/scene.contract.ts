import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "network2d",
  contractVersion: "1.0.0",
  opId: "network2d",
  label: "曲线网",
  nameEn: "Network2d",
  description: "Create operating Geometry (network) from nodes and { from, to, curve? } edges. No width, grade, or use.",
  inputs: [
    {
      name: "nodes",
      type: "point2d",
      runtimeType: "geometry",
      access: "list",
      required: true,
      defaultValue: [
        [0, 0],
        [10, 0],
        [10, 8],
      ],
      label: "节点",
    },
    {
      name: "edges",
      type: "dict",
      runtimeType: "dict",
      access: "item",
      required: true,
      defaultValue: [
        { from: 0, to: 1 },
        { from: 1, to: 2 },
      ],
      label: "边",
    },
  ],
  outputs: [
    {
      name: "geometry",
      type: "network2d",
      runtimeType: "geometry",
      access: "item",
      label: "曲线网",
    },
  ],
  deterministic: true,
})
