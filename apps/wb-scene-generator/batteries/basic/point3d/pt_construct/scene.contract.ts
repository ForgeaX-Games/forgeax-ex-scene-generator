// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "ptConstruct",
  "contractVersion": "1.0.0",
  "opId": "pt_construct",
  "description": "Compose three numbers into a point3d port value.",
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
    },
    {
      "name": "z",
      "type": "number",
      "defaultValue": 0,
      "description": "Z component.",
      "label": "z",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "point",
      "type": "point3d",
      "description": "Composed 3D point.",
      "label": "point"
    }
  ],
  "deterministic": true
})
