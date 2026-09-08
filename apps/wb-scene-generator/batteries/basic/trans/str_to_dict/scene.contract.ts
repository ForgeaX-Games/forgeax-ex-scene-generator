// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "strToDict",
  "contractVersion": "1.0.0",
  "opId": "str_to_dict",
  "description": "Parse a JSON object string like {\"key\":\"value\",...} into a dictionary.",
  "inputs": [
    {
      "name": "str",
      "type": "string",
      "description": "A JSON string like {\"key\":\"value\",...} representing an object.",
      "label": "输入字符串",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "dict",
      "type": "dict",
      "description": "The parsed key-value dictionary.",
      "label": "字典"
    }
  ],
  "deterministic": true
})
