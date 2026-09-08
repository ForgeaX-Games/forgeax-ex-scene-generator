// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridUnionMerge",
  "contractVersion": "2.0.0",
  "opId": "grid_union_merge",
  "description": "Merges multiple same-size grids: any non-zero cell across all inputs becomes 1 in the output, otherwise 0. Each input port accepts a grid list or a single grid.",
  "inputs": [],
  "outputs": [
    {
      "name": "outputGrid",
      "type": "grid",
      "access": "item",
      "description": "Union result: 1 where any input grid is non-zero, 0 where all inputs are zero.",
      "label": "输出网格"
    }
  ],
  "deterministic": true
})
