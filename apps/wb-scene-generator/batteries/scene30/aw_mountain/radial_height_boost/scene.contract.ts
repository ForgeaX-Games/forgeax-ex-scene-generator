// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "radialHeightBoost",
  "contractVersion": "2.0.0",
  "opId": "radial_height_boost",
  "description": "Applies dome-shaped radial height boosts at multiple specified positions on a heightmap, creating layered mesa or mountain effects.",
  "inputs": [
    {
      "name": "heightGrid",
      "type": "grid",
      "description": "Input heightmap grid; values 0–100 or 0–1 float (auto-detected and scaled).",
      "label": "高度场"
    },
    {
      "name": "points",
      "type": "array",
      "description": "List of dome center points, each as {x, y} with normalized coordinates (0–1).",
      "label": "穹顶中心列表"
    },
    {
      "name": "radius",
      "type": "number",
      "defaultValue": 0.3,
      "description": "Influence radius of each dome, normalized relative to the shorter grid dimension.",
      "label": "影响半径",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "heightGrid",
      "type": "grid",
      "description": "Heightmap with all dome boosts applied, values clamped to 0–100.",
      "label": "增益后高度场"
    }
  ],
  "deterministic": true
})
