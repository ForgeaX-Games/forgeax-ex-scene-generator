// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridResize",
  "contractVersion": "1.0.0",
  "opId": "grid_resize",
  "description": "Resizes an input grid to the specified dimensions. Supports nearest-neighbor, bilinear, and bicubic interpolation methods.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input grid to be resized.",
      "label": "输入网格"
    },
    {
      "name": "width",
      "type": "number",
      "defaultValue": 256,
      "description": "Width of the output grid.",
      "label": "目标宽度",
      "mode": "parameter"
    },
    {
      "name": "height",
      "type": "number",
      "defaultValue": 256,
      "description": "Height of the output grid.",
      "label": "目标高度",
      "mode": "parameter"
    },
    {
      "name": "method",
      "type": "string",
      "defaultValue": "bilinear",
      "description": "Interpolation method: nearest, bilinear, or bicubic.",
      "label": "插值方法",
      "options": [
        "nearest",
        "bilinear",
        "bicubic"
      ],
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Resized output grid.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
