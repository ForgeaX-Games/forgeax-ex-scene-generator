// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridFillOnes",
  "contractVersion": "1.0.0",
  "opId": "grid_fill_ones",
  "description": "Sets every cell in the grid (including zeros) to 1, outputting a same-size all-ones grid.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "description": "Any integer 2D grid; every cell (including zeros) will be set to 1.",
      "label": "输入网格"
    }
  ],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "description": "All-ones grid with the same dimensions as the input.",
      "label": "全1网格"
    }
  ],
  "deterministic": true
})
