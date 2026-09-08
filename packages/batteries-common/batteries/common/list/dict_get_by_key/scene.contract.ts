// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "dictGetByKey",
  "contractVersion": "1.1.0",
  "opId": "dict_get_by_key",
  "description": "Extract dictionary values by a key list or dynamic keys, outputting a value list or dynamic values.",
  "inputs": [
    {
      "name": "dict",
      "type": "dict",
      "access": "item",
      "description": "Source dictionary.",
      "label": "字典"
    },
    {
      "name": "keyList",
      "type": "string",
      "access": "list",
      "description": "Rank-1 key list.",
      "label": "Key列",
      "mode": "parameter"
    },
    {
      "name": "key_0",
      "type": "string",
      "access": "item",
      "description": "0th key.",
      "label": "Key 0",
      "mode": "parameter"
    },
    {
      "name": "key_1",
      "type": "string",
      "access": "item",
      "description": "1st key; connecting it appends a new slot.",
      "label": "Key 1",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "valueList",
      "type": "any",
      "access": "list",
      "description": "Rank-1 value list extracted by keyList.",
      "label": "值列"
    }
  ],
  "deterministic": true
})
