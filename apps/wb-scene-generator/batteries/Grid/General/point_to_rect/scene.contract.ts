// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "pointToRect",
  "contractVersion": "1.1.0",
  "opId": "point_to_rect",
  "description": "Expands each non-zero point in the grid into a rectangle mask of the specified width and height, preserving the point's mask value. Supports multiple points.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "access": "item",
      "description": "Source grid with points; non-zero cells are treated as points, zero cells as empty.",
      "label": "输入网格"
    },
    {
      "name": "width",
      "type": "number",
      "defaultValue": 3,
      "description": "Number of columns for each expanded rectangle.",
      "label": "矩形宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 3,
      "description": "Number of rows for each expanded rectangle.",
      "label": "矩形高度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Grid with each point expanded into a rectangle using the same mask value.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
