// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "treeTrim",
  "contractVersion": "1.0.0",
  "opId": "tree_trim",
  "description": "Drop the last n segments of every path; items of newly-equal paths merge in order. Remaining path length must be ≥1.",
  "inputs": [
    {
      "name": "tree",
      "type": "any",
      "access": "tree",
      "description": "Source DataTree.",
      "label": "树"
    },
    {
      "name": "n",
      "type": "number",
      "access": "tree",
      "required": false,
      "defaultValue": 1,
      "description": "Number of trailing path segments to drop (≥0).",
      "label": "层数",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "tree",
      "type": "any",
      "access": "tree",
      "description": "Trimmed DataTree.",
      "label": "树"
    }
  ],
  "deterministic": true
})
