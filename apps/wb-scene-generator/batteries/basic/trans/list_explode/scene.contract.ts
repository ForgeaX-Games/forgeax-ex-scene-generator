// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "listExplode",
  "contractVersion": "1.0.0",
  "opId": "list_explode",
  "description": "Parse a JSON array string and explode each element into an individual dynamic output port.",
  "inputs": [
    {
      "name": "list",
      "type": "string",
      "description": "A JSON array string like [...]; each element is output as an individual port.",
      "label": "输入字符串",
      "mode": "parameter"
    }
  ],
  "outputs": [],
  "deterministic": true
})
