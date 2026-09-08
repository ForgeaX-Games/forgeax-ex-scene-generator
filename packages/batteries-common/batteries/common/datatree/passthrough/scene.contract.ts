// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "passthrough",
  "contractVersion": "1.0.0",
  "opId": "passthrough",
  "description": "Output the input unchanged (identity operator). Useful as a placeholder, for wiring tidy-up, or keeping graph structure aligned. Works with any type and DataTree.",
  "inputs": [
    {
      "name": "value",
      "type": "any",
      "access": "tree",
      "description": "Any input; forwarded unchanged.",
      "label": "输入"
    }
  ],
  "outputs": [
    {
      "name": "value",
      "type": "any",
      "access": "tree",
      "description": "Identical to the input.",
      "label": "输出"
    }
  ],
  "deterministic": true
})
