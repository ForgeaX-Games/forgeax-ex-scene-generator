// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "listRemoveByIndex",
  "contractVersion": "1.1.0",
  "opId": "list_remove_by_index",
  "description": "Remove elements from a list by a index list.",
  "inputs": [
    {
      "name": "list",
      "type": "any",
      "access": "list",
      "description": "Source list.",
      "label": "列表"
    },
    {
      "name": "indices",
      "type": "number",
      "access": "list",
      "description": "Rank-1 index list; negative indices are supported.",
      "label": "索引",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "list",
      "type": "any",
      "access": "list",
      "description": "Rank-1 list after removal.",
      "label": "列表"
    }
  ],
  "deterministic": true
})
