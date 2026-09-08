// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "strToGrid",
  "contractVersion": "1.0.0",
  "opId": "str_to_grid",
  "description": "Parse a JSON string like [[1,2],[3,4]] into a grid (2D integer array).",
  "inputs": [
    {
      "name": "str",
      "type": "string",
      "description": "A JSON string like [[1,2],[3,4]] representing a 2D integer array.",
      "label": "输入字符串",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "The parsed 2D integer array (grid).",
      "label": "Grid"
    }
  ],
  "deterministic": true
})
