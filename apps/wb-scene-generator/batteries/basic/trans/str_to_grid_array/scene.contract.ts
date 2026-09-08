// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "strToGridArray",
  "contractVersion": "1.0.0",
  "opId": "str_to_grid_array",
  "description": "Recursively parse a JSON string of any format and collect all valid grids (2D integer arrays) into an array.",
  "inputs": [
    {
      "name": "str",
      "type": "string",
      "description": "A JSON string of any format. The battery recursively traverses all values to extract valid grids.",
      "label": "输入字符串",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "array",
      "type": "array",
      "description": "A list of all found grids (2D integer arrays).",
      "label": "Grid 数组"
    }
  ],
  "deterministic": true
})
