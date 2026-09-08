// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "trackSplineSmooth",
  "contractVersion": "1.0.0",
  "opId": "track_spline_smooth",
  "description": "Applies Catmull-Rom spline interpolation to skeleton polygon vertices, producing a smooth closed centerline point sequence.",
  "inputs": [
    {
      "name": "skeleton",
      "type": "array",
      "description": "Closed polygon vertices JSON string from track_skeleton_generate.",
      "label": "骨架顶点"
    },
    {
      "name": "samplesPerSegment",
      "type": "number",
      "defaultValue": 30,
      "description": "Number of interpolated samples between each pair of skeleton vertices.",
      "label": "每段采样数",
      "mode": "parameter"
    },
    {
      "name": "tension",
      "type": "number",
      "defaultValue": 0.5,
      "description": "Spline tension [0~1]; 0 is loose, 1 is tight.",
      "label": "张力系数",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "centerline",
      "type": "array",
      "description": "Smooth closed centerline sample points as JSON string [{x,y}...].",
      "label": "中心线点列"
    }
  ],
  "deterministic": true
})
