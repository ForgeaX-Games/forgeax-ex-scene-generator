// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "ruleIndoorWallGrid",
  "contractVersion": "1.0.0",
  "opId": "rule_indoor_wall_grid",
  "description": "Extracts interior walls from a processed indoor grid as a separate grid layer.",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "description": "Processed indoor grid: 0=wall/exterior, 1=corridor, 10+=rooms.",
      "label": "输入网格"
    },
    {
      "name": "footprintGrid",
      "type": "grid",
      "description": "Original building footprint (non-zero = interior), used to distinguish walls from exterior.",
      "label": "建筑轮廓网格"
    },
    {
      "name": "wallValue",
      "type": "number",
      "defaultValue": 3,
      "description": "Mask value for wall cells in wallGrid output.",
      "label": "墙体掩码值",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "Pass-through of inputGrid for downstream chaining.",
      "label": "透传网格"
    },
    {
      "name": "wallGrid",
      "type": "grid",
      "description": "Grid containing only interior walls (wallValue=wall, 0=other).",
      "label": "墙体网格"
    }
  ],
  "deterministic": true
})
