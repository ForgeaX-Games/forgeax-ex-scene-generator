// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "cosmosHeightStretch",
  "contractVersion": "1.1.0",
  "opId": "cosmos_height_stretch",
  "description": "Multiplies every cell of a height grid by a stretch factor, scaling height values proportionally.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "defaultValue": [],
      "description": "Input height map (from cosmos_terrain_gen.elevationGrid).",
      "label": "高度图"
    },
    {
      "name": "stretchFactor",
      "type": "number",
      "defaultValue": 1,
      "description": "Proportional scale factor for height values; >1 amplifies, <1 compresses, 1 = passthrough.",
      "label": "拉伸系数",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "Stretched integer height grid; each cell is the original value multiplied by stretchFactor, rounded.",
      "label": "输出高度图"
    }
  ],
  "deterministic": true
})
