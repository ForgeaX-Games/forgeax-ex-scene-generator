// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "relu",
  "contractVersion": "1.2.0",
  "opId": "relu",
  "description": "ReLU clamp: outputs the input if positive, otherwise 0. Supports Shape/Rank auto-iteration.",
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
      "description": "Result of max(0, x).",
      "label": "结果"
    }
  ],
  "deterministic": true
})
