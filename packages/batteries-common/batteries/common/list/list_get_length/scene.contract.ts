// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "listGetLength",
  "contractVersion": "1.1.0",
  "opId": "list_get_length",
  "description": "Return the element count of the outer list. List is not a base type; it means the outer list layer here.",
  "inputs": [
    {
      "name": "list",
      "type": "any",
      "access": "list",
      "description": "Rank-1 outer list.",
      "label": "列表"
    }
  ],
  "outputs": [
    {
      "name": "length",
      "type": "number",
      "access": "item",
      "description": "Element count.",
      "label": "长度"
    }
  ],
  "deterministic": true
})
