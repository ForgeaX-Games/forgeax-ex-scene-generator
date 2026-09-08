// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "pt2Construct",
  "contractVersion": "1.0.0",
  "opId": "pt2_construct",
  "description": "Compose two numbers into a point2d port value.",
  "inputs": [
    {
      "name": "x",
      "type": "number",
      "defaultValue": 0,
      "description": "X component.",
      "label": "x",
      "mode": "parameter"
    },
    {
      "name": "y",
      "type": "number",
      "defaultValue": 0,
      "description": "Y component.",
      "label": "y",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "point",
      "type": "point2d",
      "description": "Composed 2D point.",
      "label": "point"
    }
  ],
  "deterministic": true
})
