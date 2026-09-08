// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "listGetIndexByItem",
  "contractVersion": "1.1.0",
  "opId": "list_get_index_by_item",
  "description": "Reverse-lookup indices in a list by an item list or dynamic items.",
  "inputs": [
    {
      "name": "list",
      "type": "any",
      "access": "list",
      "description": "Source list.",
      "label": "列表"
    },
    {
      "name": "itemList",
      "type": "any",
      "access": "list",
      "description": "Rank-1 item list to find.",
      "label": "内容列"
    },
    {
      "name": "item_0",
      "type": "string",
      "access": "item",
      "description": "0th item.",
      "label": "Item 0",
      "mode": "parameter"
    },
    {
      "name": "item_1",
      "type": "string",
      "access": "item",
      "description": "1st item; connecting it appends a new slot.",
      "label": "Item 1",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "indicesList",
      "type": "number",
      "access": "list",
      "description": "One index list per input item.",
      "label": "索引组"
    }
  ],
  "deterministic": true
})
