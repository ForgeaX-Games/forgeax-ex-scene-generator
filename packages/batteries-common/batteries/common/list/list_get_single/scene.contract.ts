// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "listGetSingle",
  "contractVersion": "1.1.0",
  "opId": "list_get_single",
  "description": "Get one item from a list by index.",
  "inputs": [
    {
      "name": "list",
      "type": "any",
      "access": "list",
      "description": "Source list.",
      "label": "列表"
    },
    {
      "name": "index",
      "type": "number",
      "access": "item",
      "defaultValue": 0,
      "description": "Item index; negative indices are supported.",
      "label": "Index",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "item",
      "type": "any",
      "access": "item",
      "description": "Extracted item.",
      "label": "元素"
    }
  ],
  "deterministic": true
})
