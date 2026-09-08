// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "listGetIndexSingle",
  "contractVersion": "1.1.0",
  "opId": "list_get_index_single",
  "description": "Find the first index of an item in a list.",
  "inputs": [
    {
      "name": "list",
      "type": "any",
      "access": "list",
      "description": "Source list.",
      "label": "列表"
    },
    {
      "name": "item",
      "type": "any",
      "access": "item",
      "description": "Item to find.",
      "label": "元素"
    }
  ],
  "outputs": [
    {
      "name": "index",
      "type": "number",
      "access": "item",
      "description": "First matched index; -1 if not found.",
      "label": "Index"
    }
  ],
  "deterministic": true
})
