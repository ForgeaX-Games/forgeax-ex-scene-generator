// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "pt2Explode",
  "contractVersion": "1.0.0",
  "opId": "pt2_explode",
  "description": "Split a point2d into its x/y number outputs.",
  "inputs": [
    {
      "name": "point",
      "type": "point2d",
      "required": true,
      "description": "Point2D to deconstruct.",
      "label": "point"
    }
  ],
  "outputs": [
    {
      "name": "x",
      "type": "number",
      "description": "X component.",
      "label": "x"
    },
    {
      "name": "y",
      "type": "number",
      "description": "Y component.",
      "label": "y"
    }
  ],
  "deterministic": true
})
