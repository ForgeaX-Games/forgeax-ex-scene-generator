// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "tessHexGrid",
  "contractVersion": "1.0.0",
  "opId": "tess_hex_grid",
  "description": "Rasterizes the plane into a hexagonal tessellation grid, assigning each pixel the ID of its enclosing hexagon. Supports flat-top and pointy-top orientations.",
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
      "description": "Circumradius of each hexagon in cells (center to vertex). Default 10.",
      "label": "六边形半径",
      "mode": "parameter"
    },
    {
      "name": "orientation",
      "type": "string",
      "defaultValue": "flat",
      "description": "Hexagon orientation: flat=flat-top, pointy=pointy-top.",
      "label": "朝向",
      "options": [
        "flat",
        "pointy"
      ],
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "regionGrid",
      "type": "grid",
      "description": "Each cell stores the 1-based ID of its enclosing hexagon unit.",
      "label": "六边形 ID 网格"
    }
  ],
  "deterministic": true
})
