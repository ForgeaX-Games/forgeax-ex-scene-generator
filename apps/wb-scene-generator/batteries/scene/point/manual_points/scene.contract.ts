// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "manualPoint",
  "contractVersion": "2.0.0",
  "opId": "manual_points",
  "description": "Compose two numbers x and y into a single point2d point.",
  "inputs": [
    {
      "name": "x",
      "type": "number",
      "defaultValue": 0,
      "description": "X component (column axis).",
      "label": "x",
      "mode": "parameter"
    },
    {
      "name": "y",
      "type": "number",
      "defaultValue": 0,
      "description": "Y component (row axis).",
      "label": "y",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "point",
      "type": "point2d",
      "access": "item",
      "description": "The composed point2d point.",
      "label": "点"
    }
  ],
  "deterministic": true
})
