// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "maskStructure",
  "contractVersion": "1.0.0",
  "opId": "mask_structure",
  "description": "Pass grid through unchanged and preview a black/white dot mask below the node: 0 renders black, non-zero renders white dots. Useful for inspecting grid masks.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "access": "item",
      "required": true,
      "description": "Input grid; passed through unchanged and rendered as a dot mask.",
      "label": "grid"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "access": "item",
      "description": "The same grid as the input.",
      "label": "grid"
    }
  ],
  "deterministic": true
})
