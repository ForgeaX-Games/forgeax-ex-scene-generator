// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridSize",
  "contractVersion": "1.1.0",
  "opId": "grid_size",
  "description": "Computes the bounding box of all non-zero cells in a grid and outputs its width (columns) and height (rows).",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "access": "item",
      "description": "Input 2D integer grid; 0 is treated as background, non-zero cells define the bounding box.",
      "label": "输入网格"
    }
  ],
  "outputs": [
    {
      "name": "width",
      "type": "number",
      "access": "item",
      "description": "Number of columns in the bounding box of non-zero cells (maxCol - minCol + 1).",
      "label": "宽度"
    },
    {
      "name": "height",
      "type": "number",
      "access": "item",
      "description": "Number of rows in the bounding box of non-zero cells (maxRow - minRow + 1).",
      "label": "高度"
    }
  ],
  "deterministic": true
})
