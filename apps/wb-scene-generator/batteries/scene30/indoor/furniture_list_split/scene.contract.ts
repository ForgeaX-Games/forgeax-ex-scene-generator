// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "furnitureListSplit",
  "contractVersion": "1.1.0",
  "opId": "furniture_list_split",
  "description": "Parses the raw JSON string from the LLM battery into an array of furniture objects.",
  "inputs": [
    {
      "name": "result",
      "type": "string",
      "description": "Raw JSON string from the LLM battery (result port) containing the furniture_list field.",
      "label": "LLM推理结果",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "list",
      "type": "array",
      "description": "Array of furniture objects from the furniture_list field.",
      "label": "家具清单"
    }
  ],
  "deterministic": true
})
