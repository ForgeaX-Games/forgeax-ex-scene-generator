// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridFurnitureGen",
  "contractVersion": "1.0.0",
  "opId": "grid_furniture_gen",
  "description": "Generates a center-type furniture mask grid from unit size, gaps, and row/col counts, with a 0-border surrounding.",
  "inputs": [
    {
      "name": "unitW",
      "type": "number",
      "defaultValue": 2,
      "description": "Column count of each unit body (width in cells).",
      "label": "单元宽（列数）",
      "mode": "parameter"
    },
    {
      "name": "unitH",
      "type": "number",
      "defaultValue": 1,
      "description": "Row count of each unit body (height in cells).",
      "label": "单元高（行数）",
      "mode": "parameter"
    },
    {
      "name": "colGap",
      "type": "number",
      "defaultValue": 1,
      "description": "Gap between columns in cells.",
      "label": "列间距",
      "mode": "parameter"
    },
    {
      "name": "rowGap",
      "type": "number",
      "defaultValue": 1,
      "description": "Gap between rows in cells.",
      "label": "行间距",
      "mode": "parameter"
    },
    {
      "name": "cols",
      "type": "number",
      "defaultValue": 3,
      "description": "Number of units arranged horizontally.",
      "label": "列数量",
      "mode": "parameter"
    },
    {
      "name": "rows",
      "type": "number",
      "defaultValue": 4,
      "description": "Number of units arranged vertically.",
      "label": "行数量",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "mask",
      "type": "grid",
      "description": "Generated center-type furniture mask grid; 1=body, 0=aisle/border.",
      "label": "家具 mask"
    }
  ],
  "deterministic": true
})
