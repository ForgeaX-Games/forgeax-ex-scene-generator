// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridQuarterTl",
  "contractVersion": "1.0.0",
  "opId": "grid_quarter_tl",
  "description": "Extracts the top-left quarter of the input grid, outputting a subgrid of size ⌈w/2⌉ × ⌈h/2⌉.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Input grid to crop.",
      "label": "源网格"
    }
  ],
  "outputs": [
    {
      "name": "quarterGrid",
      "type": "grid",
      "description": "Top-left subgrid of size ⌈w/2⌉ × ⌈h/2⌉.",
      "label": "左上角四分之一网格"
    }
  ],
  "deterministic": true
})
