// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "equals",
  "contractVersion": "1.0.0",
  "opId": "equals",
  "description": "Test whether 'condition' equals 'rule': both sides are coerced to strings and compared; outputs true when equal, false otherwise. Accepts any input (compared as strings) and supports DataTree batching (per-branch pairing via lacing).",
  "inputs": [
    {
      "name": "condition",
      "type": "any",
      "access": "item",
      "defaultValue": "",
      "description": "The condition value to test; compared against 'rule' as a string.",
      "label": "条件"
    },
    {
      "name": "rule",
      "type": "any",
      "access": "item",
      "defaultValue": "",
      "description": "The rule value to match; compared against 'condition' as a string.",
      "label": "规则"
    }
  ],
  "outputs": [
    {
      "name": "result",
      "type": "bool",
      "access": "item",
      "description": "true when condition equals rule, false otherwise.",
      "label": "结果"
    }
  ],
  "deterministic": true
})
