// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "tessCairo",
  "contractVersion": "1.0.0",
  "opId": "tess_cairo",
  "description": "Generates a Cairo pentagonal tiling where all tiles are identical irregular pentagons, named after the street pavements of Cairo, Egypt.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "defaultValue": 80,
      "description": "Output grid width in cells. Default 80.",
      "label": "宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 80,
      "description": "Output grid height in cells. Default 80.",
      "label": "高度",
      "mode": "parameter"
    },
    {
      "name": "cellSize",
      "type": "number",
      "defaultValue": 10,
      "description": "Side length of the underlying square cell in grid units. Each pentagon spans ~2 cells. Default 10.",
      "label": "基础格边长",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "regionGrid",
      "type": "grid",
      "description": "Each cell stores the 1-based ID of its Cairo pentagon. All pentagons are identical in shape.",
      "label": "五边形 ID 网格"
    }
  ],
  "deterministic": true
})
