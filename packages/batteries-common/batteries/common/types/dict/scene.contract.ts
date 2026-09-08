// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "typeDict",
  "contractVersion": "1.0.0",
  "opId": "type_dict",
  "description": "Pass a dict through unchanged: the entire input DataTree is emitted as-is with no transform; branches/paths/version are all preserved. Useful for wiring, fan-out, placeholder, or type annotation.",
  "inputs": [
    {
      "name": "value",
      "type": "dict",
      "access": "tree",
      "required": true,
      "description": "Input dict; the entire DataTree is passed through unchanged.",
      "label": "值"
    }
  ],
  "outputs": [
    {
      "name": "value",
      "type": "dict",
      "access": "tree",
      "description": "The same dict as the input (identical DataTree, zero transform).",
      "label": "值"
    }
  ],
  "deterministic": true
})
