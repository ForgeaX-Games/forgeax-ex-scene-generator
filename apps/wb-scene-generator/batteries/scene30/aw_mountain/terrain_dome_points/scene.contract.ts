// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "terrainDomePoints",
  "contractVersion": "1.0.0",
  "opId": "terrain_dome_points",
  "description": "Randomly generates multiple dome center points in normalized coordinate space with minimum spacing constraint, outputting a list of {x, y} points.",
  "inputs": [
    {
      "name": "count",
      "type": "number",
      "defaultValue": 3,
      "description": "Number of dome center points to generate.",
      "label": "点数量",
      "mode": "parameter"
    },
    {
      "name": "minSpacing",
      "type": "number",
      "defaultValue": 0.25,
      "description": "Minimum distance between any two points, normalized (0–1), to prevent excessive dome overlap.",
      "label": "最小间距",
      "mode": "parameter"
    },
    {
      "name": "margin",
      "type": "number",
      "defaultValue": 0.1,
      "description": "Minimum distance from map edges, normalized (0–1), to avoid clipping domes.",
      "label": "边缘留白",
      "mode": "parameter"
    },
    {
      "name": "seed",
      "type": "number",
      "defaultValue": 0,
      "description": "Random seed; same seed produces identical point layout. 0 uses timestamp.",
      "label": "随机种子",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "points",
      "type": "array",
      "description": "List of dome center points, each as {x, y} with normalized coordinates (0–1).",
      "label": "穹顶中心列表"
    }
  ],
  "deterministic": true
})
