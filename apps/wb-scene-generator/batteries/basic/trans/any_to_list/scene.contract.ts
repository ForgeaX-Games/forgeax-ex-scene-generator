// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "anyToList",
  "contractVersion": "1.0.0",
  "opId": "any_to_list",
  "description": "Collect multiple any-type inputs into a list in order, with dynamic port support.",
  "inputs": [
    {
      "name": "item_0",
      "type": "any",
      "description": "First input value.",
      "label": "值0"
    },
    {
      "name": "item_1",
      "type": "any",
      "description": "Second input value; connecting it appends a new slot.",
      "label": "值1"
    }
  ],
  "outputs": [
    {
      "name": "list",
      "type": "array",
      "description": "List of all connected input values in order.",
      "label": "列表"
    }
  ],
  "deterministic": true
})
