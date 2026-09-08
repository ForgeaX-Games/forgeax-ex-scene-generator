// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "trackSkeletonGenerate",
  "contractVersion": "1.0.0",
  "opId": "track_skeleton_generate",
  "description": "Scatter random points in a space, compute convex hull, apply edge perturbation to produce a closed polygon skeleton for racing track generation.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 100,
      "description": "Width of the generation space in cells.",
      "label": "空间宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 100,
      "description": "Height of the generation space in cells.",
      "label": "空间高度",
      "mode": "parameter"
    },
    {
      "name": "pointCount",
      "type": "number",
      "defaultValue": 10,
      "description": "Number of random control points; more points = more complex skeleton.",
      "label": "控制点数量",
      "mode": "parameter"
    },
    {
      "name": "perturbScale",
      "type": "number",
      "defaultValue": 0.3,
      "description": "Perturbation scale [0~1] applied to each edge midpoint.",
      "label": "扰动幅度",
      "mode": "parameter"
    },
    {
      "name": "margin",
      "type": "number",
      "defaultValue": 10,
      "description": "Minimum margin from the boundary in cells.",
      "label": "边界留白",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; 0 uses current timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "skeleton",
      "type": "array",
      "description": "Closed polygon vertices as JSON string [{x,y}...].",
      "label": "骨架顶点"
    }
  ],
  "deterministic": true
})
