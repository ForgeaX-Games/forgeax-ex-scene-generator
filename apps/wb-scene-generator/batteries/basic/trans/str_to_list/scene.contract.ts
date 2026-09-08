// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "strToList",
  "contractVersion": "1.0.0",
  "opId": "str_to_list",
  "description": "Parse a JSON array string into a list, preserving element types as-is (string, number, object, boolean).",
  "inputs": [
    {
      "name": "str",
      "type": "string",
      "description": "A JSON array string like [...]; elements can be any type (string, number, object, etc.).",
      "label": "输入字符串",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "list",
      "type": "array",
      "description": "The parsed list with elements preserving their original types.",
      "label": "字符串列表"
    }
  ],
  "deterministic": true
})
