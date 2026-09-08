// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "tessTriGrid",
  "contractVersion": "1.0.0",
  "opId": "tess_tri_grid",
  "description": "Rasterizes the plane into an equilateral triangle tessellation grid, assigning each pixel the ID of its enclosing triangle. Up and down triangles alternate to fill the plane.",
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
      "defaultValue": 12,
      "description": "Side length of each equilateral triangle in cells. Default 12.",
      "label": "三角形边长",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "regionGrid",
      "type": "grid",
      "description": "Each cell stores the 1-based ID of its enclosing triangle unit.",
      "label": "三角形 ID 网格"
    }
  ],
  "deterministic": true
})
