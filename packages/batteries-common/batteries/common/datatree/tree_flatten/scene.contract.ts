// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "treeFlatten",
  "contractVersion": "1.0.0",
  "opId": "tree_flatten",
  "description": "Flatten all branches sequentially into a single branch at path=[0]. Empty tree stays empty.",
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
      "description": "Flattened DataTree.",
      "label": "树"
    }
  ],
  "deterministic": true
})
