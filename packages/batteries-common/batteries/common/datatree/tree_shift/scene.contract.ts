// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "treeShift",
  "contractVersion": "1.0.0",
  "opId": "tree_shift",
  "description": "Drop the leading n segments of every path. Remaining path length must be ≥1.",
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
      "description": "Number of leading path segments to drop (≥0).",
      "label": "层数",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "tree",
      "type": "any",
      "access": "tree",
      "description": "Shifted DataTree.",
      "label": "树"
    }
  ],
  "deterministic": true
})
