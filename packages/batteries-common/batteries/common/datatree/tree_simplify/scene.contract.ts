// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "treeSimplify",
  "contractVersion": "1.0.0",
  "opId": "tree_simplify",
  "description": "Strip the common prefix shared by all branches; always retain at least one path segment. Trees with 0/1 branch pass through unchanged.",
  "inputs": [
    {
      "name": "tree",
      "type": "any",
      "access": "tree",
      "description": "Source DataTree.",
      "label": "树"
    }
  ],
  "outputs": [
    {
      "name": "tree",
      "type": "any",
      "access": "tree",
      "description": "Simplified DataTree.",
      "label": "树"
    }
  ],
  "deterministic": true
})
