// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "typeImage",
  "contractVersion": "1.0.0",
  "opId": "type_image",
  "description": "Pass an image through unchanged: the entire input DataTree is emitted as-is with no transform; branches/paths/version are all preserved. Useful for wiring, fan-out, placeholder, or type annotation.",
  "inputs": [
    {
      "name": "value",
      "type": "image",
      "access": "tree",
      "required": true,
      "description": "Input image; the entire DataTree is passed through unchanged.",
      "label": "值"
    }
  ],
  "outputs": [
    {
      "name": "value",
      "type": "image",
      "access": "tree",
      "description": "The same image as the input (identical DataTree, zero transform).",
      "label": "值"
    }
  ],
  "deterministic": true
})
