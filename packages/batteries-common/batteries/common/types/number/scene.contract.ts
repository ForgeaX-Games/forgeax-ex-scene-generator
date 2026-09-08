// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "typeNumber",
  "contractVersion": "1.0.0",
  "opId": "type_number",
  "description": "Pass a number through unchanged: the entire input DataTree is emitted as-is with no transform; branches/paths/version are all preserved. Useful for wiring, fan-out, placeholder, or type annotation.",
  "inputs": [
    {
      "name": "value",
      "type": "number",
      "access": "tree",
      "required": true,
      "description": "Input number; the entire DataTree is passed through unchanged.",
      "label": "值",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "value",
      "type": "number",
      "access": "tree",
      "description": "The same number as the input (identical DataTree, zero transform).",
      "label": "值"
    }
  ],
  "deterministic": true
})
