// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "negate",
  "contractVersion": "1.1.0",
  "opId": "negate",
  "description": "Negate a number (x -> -x). Supports Shape/Rank auto-iteration.",
  "inputs": [
    {
      "name": "value",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Input number.",
      "label": "数值",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "result",
      "type": "number",
      "access": "item",
      "description": "Result of -x.",
      "label": "结果"
    }
  ],
  "deterministic": true
})
