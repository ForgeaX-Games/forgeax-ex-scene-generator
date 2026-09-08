// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "ptExplode",
  "contractVersion": "1.0.0",
  "opId": "pt_explode",
  "description": "Split a point3d into its x/y/z number outputs.",
  "inputs": [
    {
      "name": "point",
      "type": "point3d",
      "required": true,
      "description": "Point3D to deconstruct.",
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
    },
    {
      "name": "z",
      "type": "number",
      "description": "Z component.",
      "label": "z"
    }
  ],
  "deterministic": true
})
