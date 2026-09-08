// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "not",
  "contractVersion": "1.0.0",
  "opId": "not",
  "description": "Logical NOT of a boolean: true -> false, false -> true. Non-boolean input is coerced by truthiness (empty string/\"false\"/\"0\"/0 are false, others true) then negated. Supports DataTree batching.",
  "inputs": [
    {
      "name": "value",
      "type": "bool",
      "access": "item",
      "defaultValue": false,
      "description": "The boolean to negate (non-boolean input is coerced by truthiness).",
      "label": "布尔值"
    }
  ],
  "outputs": [
    {
      "name": "result",
      "type": "bool",
      "access": "item",
      "description": "The negated boolean.",
      "label": "结果"
    }
  ],
  "deterministic": true
})
