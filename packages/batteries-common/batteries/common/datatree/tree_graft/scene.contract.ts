// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "treeGraft",
  "contractVersion": "1.0.0",
  "opId": "tree_graft",
  "description": "Promote every item in every branch into its own sub-branch ({A}=[a,b,c] → {A;0}=[a],{A;1}=[b],{A;2}=[c]). Empty branches are dropped.",
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
      "description": "Grafted DataTree.",
      "label": "树"
    }
  ],
  "deterministic": true
})
