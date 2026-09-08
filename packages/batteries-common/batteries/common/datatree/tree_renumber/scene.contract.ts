// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "treeRenumber",
  "contractVersion": "1.0.0",
  "opId": "tree_renumber",
  "description": "Densify path segments at every depth to 0..N while preserving sibling order (eliminate holes left by trim/shift/merge).",
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
      "description": "Renumbered DataTree.",
      "label": "树"
    }
  ],
  "deterministic": true
})
