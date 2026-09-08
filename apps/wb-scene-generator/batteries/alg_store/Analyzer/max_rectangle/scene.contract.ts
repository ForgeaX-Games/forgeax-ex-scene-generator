// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "maxRectangle",
  "contractVersion": "1.0.0",
  "opId": "max_rectangle",
  "description": "Find the largest axis-aligned rectangle within non-zero cells of a grid. Outputs a mask grid and rectangle dimensions.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "2D number grid. Non-zero cells are treated as usable area, zero cells as obstacles.",
      "label": "输入网格"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "Grid of same size as input. Largest rectangle region marked as 1, rest as 0.",
      "label": "矩形掩码"
    },
    {
      "name": "width",
      "type": "number",
      "description": "Width (number of columns) of the largest rectangle.",
      "label": "矩形宽度"
    },
    {
      "name": "height",
      "type": "number",
      "description": "Height (number of rows) of the largest rectangle.",
      "label": "矩形高度"
    },
    {
      "name": "area",
      "type": "number",
      "description": "Area of the largest rectangle (width × height).",
      "label": "矩形面积"
    }
  ],
  "deterministic": true
})
