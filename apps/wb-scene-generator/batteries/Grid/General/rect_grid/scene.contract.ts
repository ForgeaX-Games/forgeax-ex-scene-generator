// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "rectangularGrid",
  "contractVersion": "2.0.0",
  "opId": "rect_grid",
  "description": "Create a rectangular grid of the given width and height, filling every cell with the specified value.",
  "inputs": [
    {
      "name": "width",
      "type": "number",
      "access": "item",
      "defaultValue": 50,
      "description": "Number of columns.",
      "label": "宽度",
      "mode": "parameter",
      "control": true
    },
    {
      "name": "height",
      "type": "number",
      "access": "item",
      "defaultValue": 50,
      "description": "Number of rows.",
      "label": "高度",
      "mode": "parameter",
      "control": true
    },
    {
      "name": "fillValue",
      "type": "number",
      "access": "item",
      "defaultValue": 1,
      "description": "Integer value to fill every cell with.",
      "label": "填充值",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "access": "item",
      "description": "Rectangular grid with all cells set to the specified fill value.",
      "label": "网格"
    }
  ],
  "deterministic": true
})
