// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridPassthrough",
  "contractVersion": "1.0.0",
  "opId": "grid_passthrough",
  "description": "Passes the input grid through to the output unchanged, useful for organizing wire routing on the canvas.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "The source grid to pass through.",
      "label": "输入网格"
    }
  ],
  "outputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "The grid passed through unchanged.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
