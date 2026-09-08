// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "strToNumList",
  "contractVersion": "1.0.0",
  "opId": "str_to_num_list",
  "description": "Parse a JSON array string like [1,2,3] or [\"12\",\"1\",\"3\"] into a list of numbers.",
  "inputs": [
    {
      "name": "str",
      "type": "string",
      "description": "A JSON string like [1,2,3] or [\"12\",\"1\",\"3\"] representing an array of numbers or numeric strings.",
      "label": "输入字符串",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "list",
      "type": "array",
      "description": "The parsed list of numbers.",
      "label": "数字列表"
    }
  ],
  "deterministic": true
})
