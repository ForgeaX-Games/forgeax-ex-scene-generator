// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridPad",
  "contractVersion": "1.0.0",
  "opId": "grid_pad",
  "description": "Pad a 2D grid with extra border rows/columns on each side, using a custom fill value.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input 2D grid to pad.",
      "label": "输入网格"
    },
    {
      "name": "top",
      "type": "number",
      "defaultValue": 1,
      "description": "Number of rows to pad on top.",
      "label": "上边距",
      "mode": "parameter"
    },
    {
      "name": "bottom",
      "type": "number",
      "defaultValue": 1,
      "description": "Number of rows to pad on bottom.",
      "label": "下边距",
      "mode": "parameter"
    },
    {
      "name": "left",
      "type": "number",
      "defaultValue": 1,
      "description": "Number of columns to pad on left.",
      "label": "左边距",
      "mode": "parameter"
    },
    {
      "name": "right",
      "type": "number",
      "defaultValue": 1,
      "description": "Number of columns to pad on right.",
      "label": "右边距",
      "mode": "parameter"
    },
    {
      "name": "fillValue",
      "type": "number",
      "defaultValue": 0,
      "description": "Value to fill in the padded border cells.",
      "label": "填充值",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Padded 2D grid.",
      "label": "填充网格"
    }
  ],
  "deterministic": true
})
