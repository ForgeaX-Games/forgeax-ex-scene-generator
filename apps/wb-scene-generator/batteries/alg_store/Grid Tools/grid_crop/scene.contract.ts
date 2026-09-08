// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridCrop",
  "contractVersion": "1.0.0",
  "opId": "grid_crop",
  "description": "Crop a rectangular region from a 2D grid by start row/col and width/height.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input 2D grid to crop.",
      "label": "输入网格"
    },
    {
      "name": "startRow",
      "type": "number",
      "defaultValue": 0,
      "description": "Top-left row index of the crop region (0-based).",
      "label": "起始行",
      "mode": "parameter"
    },
    {
      "name": "startCol",
      "type": "number",
      "defaultValue": 0,
      "description": "Top-left column index of the crop region (0-based).",
      "label": "起始列",
      "mode": "parameter"
    },
    {
      "name": "cropWidth",
      "type": "number",
      "defaultValue": 0,
      "description": "Number of columns to crop; 0 means crop to the right edge.",
      "label": "裁剪宽度",
      "mode": "parameter"
    },
    {
      "name": "cropHeight",
      "type": "number",
      "defaultValue": 0,
      "description": "Number of rows to crop; 0 means crop to the bottom edge.",
      "label": "裁剪高度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Cropped 2D grid.",
      "label": "裁剪网格"
    }
  ],
  "deterministic": true
})
