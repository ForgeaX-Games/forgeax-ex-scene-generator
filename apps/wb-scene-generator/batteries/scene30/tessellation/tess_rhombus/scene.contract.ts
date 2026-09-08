// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "tessRhombus",
  "contractVersion": "1.0.0",
  "opId": "tess_rhombus",
  "description": "Uses oblique coordinates to divide the plane into identical rhombus (parallelogram) cells. At 60° angle produces the classic 3D cube stack illusion.",
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
      "name": "sideLen",
      "type": "number",
      "defaultValue": 12,
      "description": "Side length of each rhombus in cells. Default 12.",
      "label": "边长",
      "mode": "parameter"
    },
    {
      "name": "angle",
      "type": "number",
      "defaultValue": 60,
      "description": "Acute angle of rhombus in degrees. 60=equilateral/cube stack, 45=square diamond. Range 20-160. Default 60.",
      "label": "倾斜角度",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "regionGrid",
      "type": "grid",
      "description": "Each cell stores the 1-based ID of its enclosing rhombus. All rhombuses are identical in shape.",
      "label": "菱形 ID 网格"
    }
  ],
  "deterministic": true
})
