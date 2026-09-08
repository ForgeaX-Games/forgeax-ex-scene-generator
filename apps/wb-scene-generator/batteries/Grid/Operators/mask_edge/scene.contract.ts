// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "maskEdge",
  "contractVersion": "1.1.0",
  "opId": "mask_edge",
  "description": "Axis-extremal edge extraction: per row takes the leftmost/rightmost non-zero cell, per column takes the topmost/bottommost non-zero cell, then unions these extremal cells while keeping their original values. This is a row/column scan of extremal cells, NOT a morphological contour—concave regions and interior holes are not outlined. For a true morphological contour (8-neighborhood boundary), use Outline (mask_outline).",
  "inputs": [
    {
      "name": "inputGrid",
      "type": "grid",
      "access": "item",
      "description": "Input 2D integer grid; non-zero values are treated as valid regions.",
      "label": "输入网格"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Same size as input; retains only the leftmost/rightmost value per row and topmost/bottommost value per column; all other cells are set to 0.",
      "label": "边缘网格"
    }
  ],
  "deterministic": true
})
