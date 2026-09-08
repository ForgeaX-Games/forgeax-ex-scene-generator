// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "booleanValue",
  "contractVersion": "1.0.0",
  "opId": "toggle",
  "description": "Output a boolean constant (on/off) toggled on the node.",
  "inputs": [],
  "outputs": [
    {
      "name": "value",
      "type": "bool",
      "access": "item",
      "description": "Current toggle state (true/false).",
      "label": "值"
    }
  ],
  "deterministic": true
})
