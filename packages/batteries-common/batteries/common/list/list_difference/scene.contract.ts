// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "listDifference",
  "contractVersion": "1.1.0",
  "opId": "list_difference",
  "description": "Subtract a sub-list from a base list and preserve original order.",
  "inputs": [
    {
      "name": "baseList",
      "type": "any",
      "access": "list",
      "description": "Base list.",
      "label": "基准"
    },
    {
      "name": "subList",
      "type": "any",
      "access": "list",
      "description": "Rank-1 list to subtract.",
      "label": "子集"
    }
  ],
  "outputs": [
    {
      "name": "diffList",
      "type": "any",
      "access": "list",
      "description": "Difference result list.",
      "label": "差集"
    }
  ],
  "deterministic": true
})
