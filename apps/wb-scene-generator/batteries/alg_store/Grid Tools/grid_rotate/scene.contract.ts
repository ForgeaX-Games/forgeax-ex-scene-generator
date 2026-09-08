// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridRotate",
  "contractVersion": "1.0.0",
  "opId": "grid_rotate",
  "description": "Rotate a 2D grid by 90°, 180°, or 270° clockwise.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input 2D grid to rotate.",
      "label": "输入网格"
    },
    {
      "name": "angle",
      "type": "string",
      "defaultValue": "90",
      "description": "Clockwise rotation angle: 90, 180, or 270 degrees.",
      "label": "旋转角度",
      "options": [
        "90",
        "180",
        "270"
      ],
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Rotated 2D grid.",
      "label": "旋转网格"
    }
  ],
  "deterministic": true
})
