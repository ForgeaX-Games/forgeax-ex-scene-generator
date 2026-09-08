// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "gridSplitByValue",
  "contractVersion": "2.0.0",
  "opId": "grid_split_by_value",
  "description": "Splits a multi-value grid into a list of grids, one per distinct non-zero value, preserving the original value at matching cells and 0 elsewhere.",
  "inputs": [
    {
      "name": "grid",
      "type": "grid",
      "access": "item",
      "description": "The multi-value grid to split.",
      "label": "输入网格"
    }
  ],
  "outputs": [
    {
      "name": "grids",
      "type": "grid",
      "access": "list",
      "description": "List of grids, one per distinct non-zero value in the input; each becomes its own child branch.",
      "label": "网格列表"
    },
    {
      "name": "values",
      "type": "number",
      "access": "list",
      "description": "Split keys aligned with grids (ascending). For elevation bands, wire to grid2node.z.",
      "label": "值列表"
    }
  ],
  "deterministic": true
})
