// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "compareGte",
  "contractVersion": "1.1.0",
  "opId": "compare_gte",
  "description": "Compare two numbers A and B. Outputs true if A >= B. Supports Shape/Rank auto-iteration.",
  "inputs": [
    {
      "name": "a",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Left operand.",
      "label": "A",
      "mode": "parameter"
    },
    {
      "name": "b",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Right operand.",
      "label": "B",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "result",
      "type": "bool",
      "access": "item",
      "description": "true if A >= B, false otherwise.",
      "label": "结果"
    }
  ],
  "deterministic": true
})
