// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "stringValue",
  "contractVersion": "1.0.0",
  "opId": "type_string",
  "description": "Pass a string through unchanged: the entire input DataTree is emitted as-is with no transform; branches/paths/version are all preserved. Useful for wiring, fan-out, placeholder, or type annotation.",
  "inputs": [
    {
      "name": "value",
      "type": "string",
      "access": "tree",
      "required": true,
      "description": "Input string; the entire DataTree is passed through unchanged.",
      "label": "值",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "value",
      "type": "string",
      "access": "tree",
      "description": "The same string as the input (identical DataTree, zero transform).",
      "label": "值"
    }
  ],
  "deterministic": true
})
