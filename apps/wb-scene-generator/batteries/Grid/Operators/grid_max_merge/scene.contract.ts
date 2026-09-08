// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridMaxMerge",
  "contractVersion": "2.0.0",
  "opId": "grid_max_merge",
  "description": "Merges multiple same-size grids by taking the maximum value at each cell across all inputs.",
  "inputs": [],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Max-merge result: each cell holds the maximum value across all input grids.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
