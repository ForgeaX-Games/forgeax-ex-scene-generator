// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "dictGetKeysByValue",
  "contractVersion": "1.1.0",
  "opId": "dict_get_keys_by_value",
  "description": "Reverse-lookup dictionary keys by a value list or dynamic values.",
  "inputs": [
    {
      "name": "dict",
      "type": "dict",
      "access": "item",
      "description": "Source dictionary.",
      "label": "字典"
    },
    {
      "name": "valueList",
      "type": "any",
      "access": "list",
      "description": "Rank-1 value list.",
      "label": "值列"
    },
    {
      "name": "val_0",
      "type": "any",
      "access": "tree",
      "description": "0th value.",
      "label": "Value 0"
    },
    {
      "name": "val_1",
      "type": "any",
      "access": "tree",
      "description": "1st value; connecting it appends a new slot.",
      "label": "Value 1"
    }
  ],
  "outputs": [
    {
      "name": "keysList",
      "type": "string",
      "access": "list",
      "description": "One key list per input value.",
      "label": "Key组"
    }
  ],
  "deterministic": true
})
