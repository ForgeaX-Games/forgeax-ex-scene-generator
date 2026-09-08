// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "tessHerringbone",
  "contractVersion": "1.0.0",
  "opId": "tess_herringbone",
  "description": "Divides the plane into herringbone-arranged 2:1 rectangular bricks. All bricks are identical in shape, alternating between horizontal and vertical orientations in a chevron (V-shape) pattern.",
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
      "name": "brickSize",
      "type": "number",
      "defaultValue": 6,
      "description": "Short side length of each brick in cells. Long side = 2 × short side. Default 6.",
      "label": "砖块短边长",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "regionGrid",
      "type": "grid",
      "description": "Each cell stores the 1-based ID of its brick. All bricks are identical 2:1 rectangles.",
      "label": "砖块 ID 网格"
    }
  ],
  "deterministic": true
})
