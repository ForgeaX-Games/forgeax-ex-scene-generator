// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "heightAdjuster",
  "contractVersion": "1.0.0",
  "opId": "height_adjuster",
  "description": "Automatically samples dome center points and applies radial height boost to a heightmap in a single step.",
  "inputs": [
    {
      "name": "heightGrid",
      "type": "grid",
      "description": "Input heightmap; accepts 0–1 noise output or 0–100 integer grid.",
      "label": "高度场"
    },
    {
      "name": "count",
      "type": "number",
      "defaultValue": 1,
      "description": "Number of dome center points to generate (minimum 1).",
      "label": "穹顶数量",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "heightGrid",
      "type": "grid",
      "description": "Heightmap after applying all dome boosts, scaled to 0–100.",
      "label": "高度场"
    }
  ],
  "deterministic": true
})
