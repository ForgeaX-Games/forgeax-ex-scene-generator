// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "passThrough",
  "contractVersion": "1.0.0",
  "opId": "pass_through",
  "description": "Dynamic multi-port pass-through: each input_i is emitted unchanged as output_i, without conversion, validation, or remapping. Useful as a placeholder, debug relay, or pipeline junction.",
  "inputs": [
    {
      "name": "input_0",
      "type": "any",
      "access": "tree",
      "defaultValue": null,
      "description": "Any input value; it will be returned unchanged.",
      "label": "输入0"
    },
    {
      "name": "input_1",
      "type": "any",
      "access": "tree",
      "defaultValue": null,
      "description": "Second input value; connecting it appends a new slot.",
      "label": "输入1"
    }
  ],
  "outputs": [],
  "deterministic": true
})
