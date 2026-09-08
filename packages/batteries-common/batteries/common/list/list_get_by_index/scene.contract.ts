// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "listGetByIndex",
  "contractVersion": "1.1.0",
  "opId": "list_get_by_index",
  "description": "Extract items from a list by an index list or dynamic indices.",
  "inputs": [
    {
      "name": "list",
      "type": "any",
      "access": "list",
      "description": "Source list.",
      "label": "列表"
    },
    {
      "name": "indexList",
      "type": "number",
      "access": "list",
      "description": "Rank-1 index list.",
      "label": "索引列",
      "mode": "parameter"
    },
    {
      "name": "index_0",
      "type": "number",
      "access": "item",
      "description": "0th index.",
      "label": "Index 0",
      "mode": "parameter"
    },
    {
      "name": "index_1",
      "type": "number",
      "access": "item",
      "description": "1st index; connecting it appends a new slot.",
      "label": "Index 1",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "subList",
      "type": "any",
      "access": "list",
      "description": "Rank-1 list extracted by indexList.",
      "label": "子列"
    }
  ],
  "deterministic": true
})
